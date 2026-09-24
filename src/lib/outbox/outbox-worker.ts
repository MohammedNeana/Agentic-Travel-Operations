import crypto from 'crypto';
import { NotificationGateway } from '@/lib/ports/notification.port';

export type OutboxDeliveryStatus =
  | 'pending'
  | 'processing'
  | 'dispatched'
  | 'failed'
  | 'dead_letter';

export interface OutboxWorkerConfig {
  maxAttempts?: number;
  baseBackoffMs?: number;
  maxBackoffMs?: number;
  batchSize?: number;
  workerId?: string;
  leaseDurationMs?: number;
}

export interface OutboxMessageItem {
  id: string;
  tenantId: string;
  eventId: string;
  recipientPhone: string;
  providerName?: string;
  message: string;
  status: OutboxDeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextRetryAt?: number;
  dispatchedAt?: string;
  deadLetterReason?: string;
  idempotencyKey: string;
  createdAt: string;
  lastError?: string;
  lockedBy?: string;
  lockedAt?: string;
  leaseExpiresAt?: number;
}

export interface OutboxBatchResult {
  totalProcessed: number;
  dispatchedCount: number;
  failedCount: number;
  deadLetterCount: number;
  items: OutboxMessageItem[];
}

export function generateOutboxIdempotencyKey(
  tenantId: string,
  eventId: string,
  recipientPhone: string,
  message: string
): string {
  return crypto
    .createHash('sha256')
    .update(`${tenantId}:${eventId}:${recipientPhone}:${message}`)
    .digest('hex');
}

export function computeExponentialBackoffMs(
  attempts: number,
  baseBackoffMs: number = 1000,
  maxBackoffMs: number = 30000
): number {
  const exponential = baseBackoffMs * Math.pow(2, Math.max(0, attempts - 1));
  const jitter = Math.floor(Math.random() * (baseBackoffMs * 0.5));
  return Math.min(exponential + jitter, maxBackoffMs);
}

export class OutboxWorker {
  private readonly maxAttempts: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly batchSize: number;
  private readonly workerId: string;
  private readonly leaseDurationMs: number;

  constructor(
    private readonly gateway: NotificationGateway,
    config?: OutboxWorkerConfig
  ) {
    this.maxAttempts = config?.maxAttempts ?? 5;
    this.baseBackoffMs = config?.baseBackoffMs ?? 1000;
    this.maxBackoffMs = config?.maxBackoffMs ?? 30000;
    this.batchSize = config?.batchSize ?? 20;
    this.workerId = config?.workerId ?? crypto.randomUUID();
    this.leaseDurationMs = config?.leaseDurationMs ?? 30000;
  }

  getWorkerId(): string {
    return this.workerId;
  }

  createItem(params: {
    tenantId: string;
    eventId: string;
    recipientPhone: string;
    message: string;
    providerName?: string;
  }): OutboxMessageItem {
    const idempotencyKey = generateOutboxIdempotencyKey(
      params.tenantId,
      params.eventId,
      params.recipientPhone,
      params.message
    );

    return {
      id: crypto.randomUUID(),
      tenantId: params.tenantId,
      eventId: params.eventId,
      recipientPhone: params.recipientPhone,
      providerName: params.providerName,
      message: params.message,
      status: 'pending',
      attempts: 0,
      maxAttempts: this.maxAttempts,
      idempotencyKey,
      createdAt: new Date().toISOString(),
    };
  }

  claimPendingBatch(
    items: OutboxMessageItem[],
    customWorkerId?: string
  ): OutboxMessageItem[] {
    const now = Date.now();
    const effectiveWorkerId = customWorkerId || this.workerId;

    const availableItems = items.filter((item) => {
      if (item.status === 'dispatched' || item.status === 'dead_letter') {
        return false;
      }

      const isRetryEligible =
        (item.status === 'pending' || item.status === 'failed') &&
        (!item.nextRetryAt || item.nextRetryAt <= now);

      const isLeaseExpired =
        item.status === 'processing' &&
        Boolean(item.leaseExpiresAt && item.leaseExpiresAt < now);

      const isAlreadyClaimedByMe =
        item.status === 'processing' && item.lockedBy === effectiveWorkerId;

      const isLockAvailable =
        !item.lockedBy ||
        item.lockedBy === effectiveWorkerId ||
        Boolean(item.leaseExpiresAt && item.leaseExpiresAt < now);

      return (isRetryEligible || isLeaseExpired || isAlreadyClaimedByMe) && isLockAvailable;
    });

    const claimed: OutboxMessageItem[] = [];

    for (const item of availableItems.slice(0, this.batchSize)) {
      item.status = 'processing';
      item.lockedBy = effectiveWorkerId;
      item.lockedAt = new Date().toISOString();
      item.leaseExpiresAt = now + this.leaseDurationMs;
      item.attempts += 1;
      claimed.push(item);
    }

    return claimed;
  }

  async processBatch(
    items: OutboxMessageItem[],
    workerId?: string
  ): Promise<OutboxBatchResult> {
    const now = Date.now();
    const claimedItems = this.claimPendingBatch(items, workerId);

    let dispatchedCount = 0;
    let failedCount = 0;
    let deadLetterCount = 0;

    for (const item of claimedItems) {
      try {
        const sendResult = await this.gateway.sendTextMessage(
          item.recipientPhone,
          item.message
        );

        if (sendResult.success) {
          item.status = 'dispatched';
          item.dispatchedAt = new Date().toISOString();
          item.lastError = undefined;
          item.lockedBy = undefined;
          item.leaseExpiresAt = undefined;
          dispatchedCount += 1;
        } else {
          const errMsg = sendResult.error || 'Gateway returned non-success response';
          item.lastError = errMsg;
          item.lockedBy = undefined;
          item.leaseExpiresAt = undefined;

          if (item.attempts >= item.maxAttempts) {
            item.status = 'dead_letter';
            item.deadLetterReason = `Max retry attempts (${item.maxAttempts}) exceeded: ${errMsg}`;
            deadLetterCount += 1;
          } else {
            item.status = 'failed';
            item.nextRetryAt = now + computeExponentialBackoffMs(item.attempts, this.baseBackoffMs, this.maxBackoffMs);
            failedCount += 1;
          }
        }
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        item.lastError = errMsg;
        item.lockedBy = undefined;
        item.leaseExpiresAt = undefined;

        if (item.attempts >= item.maxAttempts) {
          item.status = 'dead_letter';
          item.deadLetterReason = `Max retry attempts (${item.maxAttempts}) exceeded: ${errMsg}`;
          deadLetterCount += 1;
        } else {
          item.status = 'failed';
          item.nextRetryAt = now + computeExponentialBackoffMs(item.attempts, this.baseBackoffMs, this.maxBackoffMs);
          failedCount += 1;
        }
      }
    }

    return {
      totalProcessed: claimedItems.length,
      dispatchedCount,
      failedCount,
      deadLetterCount,
      items,
    };
  }

  getDeadLetterQueue(items: OutboxMessageItem[]): OutboxMessageItem[] {
    return items.filter((item) => item.status === 'dead_letter');
  }

  getPendingQueue(items: OutboxMessageItem[]): OutboxMessageItem[] {
    return items.filter((item) => item.status === 'pending' || item.status === 'failed');
  }
}
