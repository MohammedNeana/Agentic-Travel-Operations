import { describe, it, expect, vi } from 'vitest';
import { OutboxWorker, generateOutboxIdempotencyKey, computeExponentialBackoffMs } from '@/lib/outbox/outbox-worker';
import { NotificationGateway } from '@/lib/ports/notification.port';

describe('Production-Grade Outbox Worker & Dead-Letter Queue', () => {
  it('generates deterministic idempotency key for identical notification inputs', () => {
    const key1 = generateOutboxIdempotencyKey('tenant-1', 'event-1', '966500000001', 'Update message');
    const key2 = generateOutboxIdempotencyKey('tenant-1', 'event-1', '966500000001', 'Update message');
    const key3 = generateOutboxIdempotencyKey('tenant-1', 'event-2', '966500000001', 'Update message');

    expect(key1).toBe(key2);
    expect(key1).not.toBe(key3);
    expect(key1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('computes exponential backoff with upper bound cap', () => {
    const b1 = computeExponentialBackoffMs(1, 1000, 30000);
    const b2 = computeExponentialBackoffMs(2, 1000, 30000);
    const b3 = computeExponentialBackoffMs(3, 1000, 30000);
    const bCapped = computeExponentialBackoffMs(10, 1000, 30000);

    expect(b1).toBeGreaterThanOrEqual(1000);
    expect(b2).toBeGreaterThanOrEqual(2000);
    expect(b3).toBeGreaterThanOrEqual(4000);
    expect(bCapped).toBeLessThanOrEqual(30000);
  });

  it('processes batch, dispatches successfully and marks items dispatched', async () => {
    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'wa-msg-1' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 1, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const worker = new OutboxWorker(gateway);
    const item = worker.createItem({
      tenantId: 'tenant-alula-dmc',
      eventId: 'evt-001',
      recipientPhone: '966500000001',
      message: 'Notice to provider',
    });

    const result = await worker.processBatch([item]);
    expect(result.totalProcessed).toBe(1);
    expect(result.dispatchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(item.status).toBe('dispatched');
    expect(item.dispatchedAt).toBeDefined();
    expect(item.attempts).toBe(1);
  });

  it('handles temporary delivery failures by incrementing attempts and setting backoff', async () => {
    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: false, error: 'Rate limit exceeded' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const worker = new OutboxWorker(gateway, { maxAttempts: 3, baseBackoffMs: 500 });
    const item = worker.createItem({
      tenantId: 'tenant-alula-dmc',
      eventId: 'evt-002',
      recipientPhone: '966500000002',
      message: 'Retry notice',
    });

    const result = await worker.processBatch([item]);
    expect(result.failedCount).toBe(1);
    expect(item.status).toBe('failed');
    expect(item.attempts).toBe(1);
    expect(item.nextRetryAt).toBeGreaterThan(Date.now());
    expect(item.lastError).toBe('Rate limit exceeded');
  });

  it('transitions repeatedly failing messages to dead_letter queue after max attempts', async () => {
    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: false, error: 'WhatsApp Cloud API 500 Error' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const worker = new OutboxWorker(gateway, { maxAttempts: 2, baseBackoffMs: 10 });
    const item = worker.createItem({
      tenantId: 'tenant-alula-dmc',
      eventId: 'evt-003',
      recipientPhone: '966500000003',
      message: 'Failing notice',
    });

    await worker.processBatch([item]);
    expect(item.status).toBe('failed');
    expect(item.attempts).toBe(1);

    item.nextRetryAt = Date.now() - 1000;
    const finalResult = await worker.processBatch([item]);

    expect(finalResult.deadLetterCount).toBe(1);
    expect(item.status).toBe('dead_letter');
    expect(item.attempts).toBe(2);
    expect(item.deadLetterReason).toContain('Max retry attempts (2) exceeded');

    const dlq = worker.getDeadLetterQueue([item]);
    expect(dlq.length).toBe(1);
    expect(dlq[0].id).toBe(item.id);
  });
});
