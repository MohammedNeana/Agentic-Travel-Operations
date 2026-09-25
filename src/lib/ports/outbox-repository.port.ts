import { OutboxMessageItem } from '../outbox/outbox-worker';

export interface ClaimBatchParams {
  workerId: string;
  batchSize?: number;
  leaseSeconds?: number;
  tenantId?: string;
}

export interface OutboxRepositoryPort {
  claimBatch(params: ClaimBatchParams): Promise<OutboxMessageItem[]>;
  markDispatched(id: string, dispatchedAt: string, tenantId?: string): Promise<void>;
  markFailed(id: string, nextRetryAt: number, error: string, tenantId?: string): Promise<void>;
  markDeadLetter(id: string, reason: string, tenantId?: string): Promise<void>;
}
