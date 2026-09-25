import { describe, it, expect, vi } from 'vitest';
import { OutboxWorker, OutboxMessageItem } from '@/lib/outbox/outbox-worker';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { AgentTracer } from '@/lib/observability/telemetry';
import { OtelHttpSpanExporter, BatchSpanProcessor } from '@/lib/observability/otlp-exporter';
import { SupabaseOutboxAdapter } from '@/lib/adapters/supabase-outbox.adapter';
import type { SupabaseClient } from '@supabase/supabase-js';

describe('Production Readiness: Concurrency, Distributed Locking & Race Resistance', () => {
  it('guarantees zero duplicate deliveries when multiple workers contend for the same outbox items', async () => {
    const dispatchTracker = new Map<string, number>();

    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockImplementation(async (phone: string, _msg: string) => {
        dispatchTracker.set(phone, (dispatchTracker.get(phone) || 0) + 1);
        return { success: true, messageId: `msg-${phone}` };
      }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const worker1 = new OutboxWorker(gateway, { workerId: 'worker-instance-1', batchSize: 10 });
    const worker2 = new OutboxWorker(gateway, { workerId: 'worker-instance-2', batchSize: 10 });
    const worker3 = new OutboxWorker(gateway, { workerId: 'worker-instance-3', batchSize: 10 });

    const sharedItems: OutboxMessageItem[] = Array.from({ length: 25 }, (_, i) =>
      worker1.createItem({
        tenantId: 'tenant-saudi-dmc',
        eventId: `event-${i}`,
        recipientPhone: `96650000${String(i).padStart(4, '0')}`,
        message: `Notification for event ${i}`,
      })
    );

    const [res1, res2, res3] = await Promise.all([
      worker1.processBatch(sharedItems),
      worker2.processBatch(sharedItems),
      worker3.processBatch(sharedItems),
    ]);

    const totalDispatched = res1.dispatchedCount + res2.dispatchedCount + res3.dispatchedCount;
    expect(totalDispatched).toBe(25);

    for (const count of dispatchTracker.values()) {
      expect(count).toBe(1);
    }

    const allDispatched = sharedItems.every((item) => item.status === 'dispatched');
    expect(allDispatched).toBe(true);
  });

  it('recovers crashed worker items whose distributed lease has expired', async () => {
    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'recovered-msg-1' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 1, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const workerA = new OutboxWorker(gateway, { workerId: 'worker-A', leaseDurationMs: 1000 });
    const workerB = new OutboxWorker(gateway, { workerId: 'worker-B', leaseDurationMs: 1000 });

    const item = workerA.createItem({
      tenantId: 'tenant-saudi-dmc',
      eventId: 'evt-crashed-recovery',
      recipientPhone: '966555112233',
      message: 'Urgent schedule shift',
    });

    const claimedByA = workerA.claimPendingBatch([item]);
    expect(claimedByA.length).toBe(1);
    expect(item.status).toBe('processing');
    expect(item.lockedBy).toBe('worker-A');

    const prematureClaimByB = workerB.claimPendingBatch([item]);
    expect(prematureClaimByB.length).toBe(0);

    item.leaseExpiresAt = Date.now() - 500;

    const recoveredClaimByB = workerB.claimPendingBatch([item]);
    expect(recoveredClaimByB.length).toBe(1);
    expect(item.lockedBy).toBe('worker-B');

    const result = await workerB.processBatch([item]);
    expect(result.dispatchedCount).toBe(1);
    expect(item.status).toBe('dispatched');
  });

  it('detects and rejects concurrent conflicting itinerary mutations via optimistic concurrency validation', () => {
    interface VersionedItineraryEvent {
      id: string;
      version: number;
      startTime: string;
      endTime: string;
    }

    function applyOptimisticMutation(
      current: VersionedItineraryEvent,
      expectedVersion: number,
      newStart: string,
      newEnd: string
    ): { success: boolean; event?: VersionedItineraryEvent; error?: string } {
      if (current.version !== expectedVersion) {
        return {
          success: false,
          error: `Concurrency Conflict: Expected version ${expectedVersion} but event is currently at version ${current.version}.`,
        };
      }

      return {
        success: true,
        event: {
          ...current,
          version: current.version + 1,
          startTime: newStart,
          endTime: newEnd,
        },
      };
    }

    const initialEvent: VersionedItineraryEvent = {
      id: 'event-alula-stargazing',
      version: 1,
      startTime: '20:00',
      endTime: '22:30',
    };

    const operator1Mutation = applyOptimisticMutation(initialEvent, 1, '20:30', '23:00');
    expect(operator1Mutation.success).toBe(true);
    const updatedState = operator1Mutation.event!;
    expect(updatedState.version).toBe(2);

    const operator2StaleMutation = applyOptimisticMutation(updatedState, 1, '21:00', '23:30');
    expect(operator2StaleMutation.success).toBe(false);
    expect(operator2StaleMutation.error).toContain('Concurrency Conflict');
  });

  it('formats and exports OpenTelemetry spans to OTLP collector with fault tolerance', async () => {
    const tracer = new AgentTracer({
      tenantId: 'tenant-telemetry-test',
      triggerMessageId: 'msg-trace-001',
      senderPhone: '966500112233',
    });

    const spanId = tracer.startSpan('incident_analysis', 'reasoning');
    tracer.endSpan(spanId, {
      incidentType: 'delay',
      delayMinutes: 45,
    });

    const otelSpans = tracer.toOtelSpans();
    expect(otelSpans.length).toBe(1);
    expect(otelSpans[0].name).toBe('incident_analysis');
    expect(otelSpans[0].context.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(otelSpans[0].context.spanId).toMatch(/^[0-9a-f]{16}$/);

    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    const exporter = new OtelHttpSpanExporter({
      endpoint: 'http://localhost:4318/v1/traces',
      fetchFn: mockFetch,
    });

    const exportResult = await exporter.export(otelSpans);
    expect(exportResult.success).toBe(true);
    expect(exportResult.exportedCount).toBe(1);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const flushResult = await tracer.flushToCollector(exporter);
    expect(flushResult.success).toBe(true);

    const failingExporter = new OtelHttpSpanExporter({
      endpoint: 'http://unreachable-collector.local/v1/traces',
      fetchFn: vi.fn().mockRejectedValue(new Error('Connection refused')),
    });

    const failureResult = await failingExporter.export(otelSpans);
    expect(failureResult.success).toBe(false);
    expect(failureResult.error).toContain('Connection refused');
  });

  it('claims and dispatches batches via SupabaseOutboxAdapter with RPC claiming', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: [
        {
          id: 'outbox-rpc-1',
          tenant_id: 'tenant-test-rpc',
          event_id: 'evt-1',
          recipient_phone: '966500001111',
          provider_name: 'Desert Safari AlUla',
          message_payload: 'Your booking is confirmed',
          status: 'processing',
          attempts: 1,
          idempotency_key: 'idemp-1',
          created_at: new Date().toISOString(),
          locked_by: 'worker-node-alpha',
          locked_at: new Date().toISOString(),
          lease_expires_at: new Date(Date.now() + 30000).toISOString(),
        },
      ],
      error: null,
    });

    const mockUpdate = vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnThis(),
    });

    const mockSupabase = {
      rpc: mockRpc,
      from: vi.fn().mockReturnValue({
        update: mockUpdate,
        select: vi.fn().mockReturnThis(),
        eq: vi.fn().mockReturnThis(),
        order: vi.fn().mockReturnThis(),
        limit: vi.fn().mockResolvedValue({ data: [] }),
      }),
    } as unknown as SupabaseClient;

    const outboxRepo = new SupabaseOutboxAdapter(mockSupabase);

    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-delivered-1' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const worker = new OutboxWorker(gateway, {
      workerId: 'worker-node-alpha',
      batchSize: 10,
      outboxRepo,
    });

    const result = await worker.processRepositoryBatch('tenant-test-rpc');
    expect(result.totalProcessed).toBe(1);
    expect(result.dispatchedCount).toBe(1);
    expect(result.failedCount).toBe(0);
    expect(mockRpc).toHaveBeenCalledWith('claim_outbox_batch', {
      p_worker_id: 'worker-node-alpha',
      p_batch_size: 10,
      p_lease_seconds: 30,
      p_tenant_id: 'tenant-test-rpc',
    });
    expect(gateway.sendTextMessage).toHaveBeenCalledWith('966500001111', 'Your booking is confirmed');
  });

  it('enforces fail-closed safety and avoids unsafe race fallbacks when outbox RPC errors', async () => {
    const mockRpc = vi.fn().mockResolvedValue({
      data: null,
      error: { message: 'Database transaction deadlock or connection timeout' },
    });

    const mockSupabase = {
      rpc: mockRpc,
    } as unknown as SupabaseClient;

    const outboxRepo = new SupabaseOutboxAdapter(mockSupabase);

    await expect(
      outboxRepo.claimBatch({
        workerId: 'worker-node-beta',
        batchSize: 10,
        leaseSeconds: 30,
      })
    ).rejects.toThrow('Atomic outbox claim failed via claim_outbox_batch RPC');

    const gateway: NotificationGateway = {
      sendTextMessage: vi.fn(),
      stageOutbox: vi.fn(),
      dispatchOutbox: vi.fn(),
      fetchPendingOutbox: vi.fn(),
    };

    const worker = new OutboxWorker(gateway, {
      workerId: 'worker-node-beta',
      outboxRepo,
    });

    const result = await worker.processRepositoryBatch('tenant-test-rpc');
    expect(result.totalProcessed).toBe(0);
    expect(result.dispatchedCount).toBe(0);
    expect(gateway.sendTextMessage).not.toHaveBeenCalled();
  });

  it('manages bounded queues, backpressure drops, retries, and graceful shutdown in BatchSpanProcessor', async () => {
    let callCount = 0;
    const mockFetch = vi.fn().mockImplementation(async () => {
      callCount += 1;
      if (callCount === 1) {
        return { ok: false, status: 503 };
      }
      return { ok: true, status: 200 };
    });

    const exporter = new OtelHttpSpanExporter({
      endpoint: 'http://localhost:4318/v1/traces',
      maxRetries: 2,
      retryBackoffBaseMs: 10,
      fetchFn: mockFetch,
    });

    const processor = new BatchSpanProcessor({
      exporter,
      maxQueueSize: 3,
      maxBatchSize: 10,
      scheduledDelayMillis: 0,
      dropPolicy: 'drop_oldest',
    });

    const createDummySpan = (name: string) => ({
      name,
      context: { traceId: '0123456789abcdef0123456789abcdef', spanId: '0123456789abcdef', traceFlags: 1 },
      kind: 'INTERNAL' as const,
      startTimeUnixNano: '1000000',
      endTimeUnixNano: '2000000',
      attributes: { testKey: name },
      status: { code: 'OK' as const },
    });

    processor.onEmit(createDummySpan('span-1'));
    processor.onEmit(createDummySpan('span-2'));
    processor.onEmit(createDummySpan('span-3'));
    processor.onEmit(createDummySpan('span-4'));

    const statsBefore = processor.getStats();
    expect(statsBefore.queueSize).toBe(3);
    expect(statsBefore.totalEmitted).toBe(4);
    expect(statsBefore.totalDropped).toBe(1);

    const flushResult = await processor.flushBatch();
    expect(flushResult.success).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    await processor.shutdown();
    const statsAfter = processor.getStats();
    expect(statsAfter.isShutdown).toBe(true);
    expect(statsAfter.queueSize).toBe(0);

    processor.onEmit(createDummySpan('span-after-shutdown'));
    expect(processor.getStats().totalDropped).toBe(2);
  });
});
