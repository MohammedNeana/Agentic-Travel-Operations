import { describe, it, expect, vi, beforeEach } from 'vitest';
import { acquireMessageProcessingLock, clearIdempotencyCache } from '@/lib/whatsapp/idempotency';
import { TravelOperationsOrchestrator } from '@/lib/application/travel-operations.orchestrator';
import { ItineraryRepository, SupplierRepository } from '@/lib/ports/repository.port';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { LLMProvider } from '@/lib/ports/llm.port';
import { OutboxWorker } from '@/lib/outbox/outbox-worker';

describe('Chaos & High-Concurrency Resilience Testing', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearIdempotencyCache();
  });

  it('guarantees mutual exclusion and idempotency under a 50-request concurrent storm', async () => {
    const stormMessageId = 'msg-chaos-concurrency-storm-999';

    const concurrentAttempts = Array.from({ length: 50 }, () =>
      acquireMessageProcessingLock(stormMessageId)
    );

    const outcomes = await Promise.all(concurrentAttempts);

    const acquiredLocks = outcomes.filter((res) => res.acquired);
    const rejectedLocks = outcomes.filter((res) => !res.acquired);

    expect(acquiredLocks.length).toBe(1);
    expect(rejectedLocks.length).toBe(49);
    for (const rejected of rejectedLocks) {
      expect(rejected.state).toBe('processing');
    }
  });

  it('preserves system availability when LLM times out by activating deterministic fallback', async () => {
    const targetEvent = {
      id: 'evt-chaos-01',
      itinerary_id: 'itin-chaos-01',
      tenant_id: 'tenant-chaos-dmc',
      event_date: '2026-10-30',
      start_time: '10:00:00',
      end_time: '12:00:00',
      title: 'Dune Buggy Safari',
      status: 'confirmed',
      sort_order: 1,
      experience_provider_id: 'prov-chaos-guide',
    };

    const subsequentEvent = {
      id: 'evt-chaos-02',
      itinerary_id: 'itin-chaos-01',
      tenant_id: 'tenant-chaos-dmc',
      event_date: '2026-10-30',
      start_time: '13:00:00',
      end_time: '15:00:00',
      title: 'Oasis Camp Dinner',
      status: 'confirmed',
      sort_order: 2,
      experience_provider_id: 'prov-chaos-camp',
    };

    const itineraryRepo: ItineraryRepository = {
      getTargetEvent: vi.fn().mockResolvedValue(targetEvent),
      getDayEvents: vi.fn().mockResolvedValue([targetEvent, subsequentEvent]),
      getItinerary: vi.fn().mockResolvedValue({
        id: 'itin-chaos-01',
        title: 'Chaos Itinerary',
        guest_count: 2,
        traveler_profile_id: 'prof-chaos',
        tenant_id: 'tenant-chaos-dmc',
      }),
      getTravelerProfile: vi.fn().mockResolvedValue(null),
      getSnapshots: vi.fn().mockResolvedValue([]),
      updateEvent: vi.fn().mockResolvedValue(true),
      rollbackEvent: vi.fn().mockResolvedValue(undefined),
      executeAtomicCascade: vi.fn().mockImplementation(async (params) => ({
        success: true,
        updatedEventsCount: params.adjustments.length,
        stagedOutboxNotices: params.outboxNotices.map((n: any) => ({
          id: 'outbox-chaos-id',
          tenantId: params.tenantId,
          eventId: n.eventId,
          providerPhone: n.providerPhone,
          message: n.message,
          status: 'pending',
          attempts: 0,
        })),
      })),
    };

    const supplierRepo: SupplierRepository = {
      findProviderByPhone: vi.fn().mockResolvedValue({
        id: 'prov-chaos-guide',
        name: 'Guide Salem',
        phone_number: '966500000888',
        tenant_id: 'tenant-chaos-dmc',
      }),
      getProviders: vi.fn().mockResolvedValue([
        {
          id: 'prov-chaos-guide',
          name: 'Guide Salem',
          phone_number: '966500000888',
          tenant_id: 'tenant-chaos-dmc',
        },
        {
          id: 'prov-chaos-camp',
          name: 'Camp Team',
          phone_number: '966500000777',
          tenant_id: 'tenant-chaos-dmc',
        },
      ]),
    };

    const notificationGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 1, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const faultyLLM: LLMProvider = {
      generateJson: vi.fn().mockRejectedValue(new Error('ETIMEDOUT: Groq API took longer than 15000ms')),
    };

    const orchestrator = new TravelOperationsOrchestrator({
      llmProvider: faultyLLM,
      itineraryRepo,
      supplierRepo,
      notificationGateway,
    });

    const result = await orchestrator.orchestrateCascade({
      eventId: 'evt-chaos-01',
      vendorMessage: 'تأخرنا ساعتين بسبب الزحمة',
      senderPhone: '966500000888',
      tenantId: 'tenant-chaos-dmc',
    });

    expect(result.success).toBe(true);
    expect(faultyLLM.generateJson).toHaveBeenCalledTimes(1);
    expect(result.updatedEventsCount).toBeGreaterThan(0);
    expect(result.incidentSummary).toContain('تأخير تشغيلي');
    expect(itineraryRepo.executeAtomicCascade).toHaveBeenCalledTimes(1);
  });

  it('recovers cleanly when notifications fail by retaining outbox records for retry', async () => {
    let shouldFail = true;

    const failingGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockImplementation(async () => {
        if (shouldFail) {
          return { success: false, error: 'Connection refused by WhatsApp proxy' };
        }
        return { success: true, messageId: 'wa-recovered-001' };
      }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const worker = new OutboxWorker(failingGateway, { maxAttempts: 3, baseBackoffMs: 10 });
    const item = worker.createItem({
      tenantId: 'tenant-chaos-dmc',
      eventId: 'evt-resilience-01',
      recipientPhone: '966500000666',
      message: 'Critical downstream alert',
    });

    const firstRun = await worker.processBatch([item]);
    expect(firstRun.failedCount).toBe(1);
    expect(item.status).toBe('failed');
    expect(item.attempts).toBe(1);

    shouldFail = false;
    item.nextRetryAt = Date.now() - 100;

    const secondRun = await worker.processBatch([item]);
    expect(secondRun.dispatchedCount).toBe(1);
    expect(item.status).toBe('dispatched');
    expect(item.attempts).toBe(2);
    expect(item.dispatchedAt).toBeDefined();
  });
});
