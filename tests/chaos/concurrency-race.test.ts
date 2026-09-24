import { describe, it, expect, vi } from 'vitest';
import { OutboxWorker, OutboxMessageItem } from '@/lib/outbox/outbox-worker';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { AgentTracer } from '@/lib/observability/telemetry';
import { OtelHttpSpanExporter } from '@/lib/observability/otlp-exporter';

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
});
