import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TravelOperationsOrchestrator } from '@/lib/application/travel-operations.orchestrator';
import { ItineraryRepository, SupplierRepository } from '@/lib/ports/repository.port';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { LLMProvider } from '@/lib/ports/llm.port';
import { AuditLogPort, AgentAuditEntry } from '@/lib/ports/audit-log.port';
import { acquireMessageProcessingLock, markMessageCompleted, clearIdempotencyCache } from '@/lib/whatsapp/idempotency';
import { OtelHttpSpanExporter, BatchSpanProcessor } from '@/lib/observability/otlp-exporter';
import { AgentTracer } from '@/lib/observability/telemetry';

describe('Failure-Oriented Integration Resilience Test Suite', () => {
  const testTenantId = 'tenant-saudi-dmc-prod';

  const mockTargetEvent = {
    id: 'evt-morning-tour',
    itinerary_id: 'itin-riyadh-001',
    tenant_id: testTenantId,
    event_date: '2026-11-20',
    start_time: '09:00:00',
    end_time: '11:30:00',
    title: 'Diriyah Historical Tour',
    status: 'confirmed',
    sort_order: 1,
    experience_provider_id: 'prov-guide-waleed',
  };

  const mockFlightEvent = {
    id: 'evt-flight-immutable',
    itinerary_id: 'itin-riyadh-001',
    tenant_id: testTenantId,
    event_date: '2026-11-20',
    start_time: '12:00:00',
    end_time: '14:00:00',
    title: 'Flight SV102 to AlUla',
    status: 'confirmed',
    sort_order: 2,
    experience_provider_id: 'prov-airline',
    is_immutable: true,
  };

  const mockProviders = [
    {
      id: 'prov-guide-waleed',
      name: 'Waleed Al-Ghamdi',
      phone_number: '966512345678',
      tenant_id: testTenantId,
    },
    {
      id: 'prov-airline',
      name: 'Saudia Airline',
      phone_number: '966599999999',
      tenant_id: testTenantId,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    clearIdempotencyCache();
  });

  it('scenario 1: rejects when LLM proposes an invariant violation and prevents database mutation', async () => {
    const itineraryRepo: ItineraryRepository = {
      getTargetEvent: vi.fn().mockResolvedValue(mockTargetEvent),
      getDayEvents: vi.fn().mockResolvedValue([mockTargetEvent, mockFlightEvent]),
      getItinerary: vi.fn().mockResolvedValue({
        id: 'itin-riyadh-001',
        title: 'Saudi Cultural Journey',
        guest_count: 5,
        tenant_id: testTenantId,
      }),
      getTravelerProfile: vi.fn().mockResolvedValue(null),
      getSnapshots: vi.fn().mockResolvedValue([]),
      updateEvent: vi.fn().mockResolvedValue(true),
      rollbackEvent: vi.fn().mockResolvedValue(undefined),
      executeAtomicCascade: vi.fn(),
    };

    const supplierRepo: SupplierRepository = {
      findProviderByPhone: vi.fn().mockImplementation(async (phone) => {
        return mockProviders.find((p) => p.phone_number === phone) || null;
      }),
      getProviders: vi.fn().mockResolvedValue(mockProviders),
    };

    const notificationGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const faultyLLM: LLMProvider = {
      generateJson: vi.fn().mockResolvedValue({
        data: {
          delayMinutes: 240,
          incidentType: 'delay',
          isCascadeImpact: true,
          incidentSummary: 'Delay pushing directly into departure flight',
          scheduleAdjustments: [
            {
              eventId: 'evt-morning-tour',
              eventTitle: 'Diriyah Historical Tour',
              previousStartTime: '09:00',
              previousEndTime: '11:30',
              newStartTime: '12:00',
              newEndTime: '14:30',
              newStatus: 'escalated',
              reason: 'Four hour traffic jam',
            },
            {
              eventId: 'evt-flight-immutable',
              eventTitle: 'Flight SV102 to AlUla',
              previousStartTime: '12:00',
              previousEndTime: '14:00',
              newStartTime: '15:00',
              newEndTime: '17:00',
              newStatus: 'escalated',
              reason: 'Illegal flight shift proposal',
            },
          ],
          downstreamNotices: [],
        },
      }),
    };

    const recordedAudits: AgentAuditEntry[] = [];
    const auditLog: AuditLogPort = {
      record: vi.fn().mockImplementation(async (entry) => {
        recordedAudits.push(entry);
        return { success: true, persistedToDb: true, operationId: entry.operationId };
      }),
    };

    const orchestrator = new TravelOperationsOrchestrator({
      llmProvider: faultyLLM,
      itineraryRepo,
      supplierRepo,
      notificationGateway,
      auditLog,
    });

    const result = await orchestrator.orchestrateCascade({
      eventId: 'evt-morning-tour',
      vendorMessage: 'تأخرنا 4 ساعات بسبب تعطل الباص بالكامل',
      senderPhone: '966512345678',
      tenantId: testTenantId,
    });

    expect(result.success).toBe(false);
    expect(result.validationViolations).toBeDefined();
    expect(result.validationViolations?.length).toBeGreaterThan(0);
    expect(itineraryRepo.executeAtomicCascade).not.toHaveBeenCalled();
    expect(notificationGateway.dispatchOutbox).not.toHaveBeenCalled();
    expect(itineraryRepo.updateEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'evt-morning-tour',
        status: 'escalated',
      }),
      testTenantId
    );
    expect(recordedAudits.length).toBe(1);
    expect(recordedAudits[0].operationType).toBe('action_boundary_block');
  });

  it('scenario 2: preserves committed database changes and retains staged outbox items when notification dispatch fails', async () => {
    const itineraryRepo: ItineraryRepository = {
      getTargetEvent: vi.fn().mockResolvedValue(mockTargetEvent),
      getDayEvents: vi.fn().mockResolvedValue([mockTargetEvent]),
      getItinerary: vi.fn().mockResolvedValue({
        id: 'itin-riyadh-001',
        title: 'Saudi Cultural Journey',
        guest_count: 2,
        tenantId: testTenantId,
      }),
      getTravelerProfile: vi.fn().mockResolvedValue(null),
      getSnapshots: vi.fn().mockResolvedValue([]),
      updateEvent: vi.fn().mockResolvedValue(true),
      rollbackEvent: vi.fn().mockResolvedValue(undefined),
      executeAtomicCascade: vi.fn().mockResolvedValue({
        success: true,
        updatedEventsCount: 1,
        stagedOutboxNotices: [
          {
            id: 'outbox-staged-999',
            tenantId: testTenantId,
            eventId: 'evt-morning-tour',
            providerName: 'Waleed Al-Ghamdi',
            providerPhone: '966512345678',
            message: 'تم ترحيل الموعد بنجاح',
            status: 'pending',
            attempts: 0,
          },
        ],
      }),
    };

    const supplierRepo: SupplierRepository = {
      findProviderByPhone: vi.fn().mockResolvedValue(mockProviders[0]),
      getProviders: vi.fn().mockResolvedValue(mockProviders),
    };

    const failingGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: false, error: 'Network timeout to WhatsApp Cloud API' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({
        dispatchedCount: 0,
        updatedNotices: [
          {
            id: 'outbox-staged-999',
            tenantId: testTenantId,
            eventId: 'evt-morning-tour',
            providerName: 'Waleed Al-Ghamdi',
            providerPhone: '966512345678',
            message: 'تم ترحيل الموعد بنجاح',
            status: 'failed',
            attempts: 1,
            error: 'HTTP 504 Gateway Timeout',
          },
        ],
      }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const llmProvider: LLMProvider = {
      generateJson: vi.fn().mockResolvedValue({
        data: {
          delayMinutes: 30,
          incidentType: 'delay',
          isCascadeImpact: false,
          incidentSummary: 'Minor traffic adjustment',
          scheduleAdjustments: [
            {
              eventId: 'evt-morning-tour',
              eventTitle: 'Diriyah Historical Tour',
              previousStartTime: '09:00',
              previousEndTime: '11:30',
              newStartTime: '09:30',
              newEndTime: '12:00',
              newStatus: 'escalated',
              reason: 'Minor traffic delay',
            },
          ],
          downstreamNotices: [
            {
              eventId: 'evt-morning-tour',
              providerName: 'Waleed Al-Ghamdi',
              providerPhone: '966512345678',
              newStartTime: '09:30',
              whatsappMessage: 'تم ترحيل الموعد بنجاح',
            },
          ],
        },
      }),
    };

    const orchestrator = new TravelOperationsOrchestrator({
      llmProvider,
      itineraryRepo,
      supplierRepo,
      notificationGateway: failingGateway,
    });

    const result = await orchestrator.orchestrateCascade({
      eventId: 'evt-morning-tour',
      vendorMessage: 'تأخير نص ساعة في الطريق',
      senderPhone: '966512345678',
      tenantId: testTenantId,
    });

    expect(result.success).toBe(true);
    expect(result.updatedEventsCount).toBe(1);
    expect(result.dispatchedNoticesCount).toBe(0);
    expect(itineraryRepo.executeAtomicCascade).toHaveBeenCalledTimes(1);
    expect(result.outboxNotices?.[0].status).toBe('failed');
    expect(result.outboxNotices?.[0].error).toContain('HTTP 504');
  });

  it('scenario 3: suppresses duplicate webhook payload via distributed idempotency lock', async () => {
    const duplicateMessageId = 'wam-duplicate-race-test-777';

    const firstAttempt = await acquireMessageProcessingLock(duplicateMessageId);
    expect(firstAttempt.acquired).toBe(true);
    expect(firstAttempt.state).toBe('processing');

    const secondAttempt = await acquireMessageProcessingLock(duplicateMessageId);
    expect(secondAttempt.acquired).toBe(false);
    expect(secondAttempt.state).toBe('processing');

    await markMessageCompleted(duplicateMessageId, {
      status: 'completed',
      category: 'Delay',
      actionTaken: 'schedule_cascade_orchestrated',
    });

    const thirdAttempt = await acquireMessageProcessingLock(duplicateMessageId);
    expect(thirdAttempt.acquired).toBe(false);
    expect(thirdAttempt.state).toBe('completed');
  });

  it('scenario 4: gracefully rolls back and reports failure when optimistic concurrency version conflict occurs', async () => {
    const itineraryRepo: ItineraryRepository = {
      getTargetEvent: vi.fn().mockResolvedValue(mockTargetEvent),
      getDayEvents: vi.fn().mockResolvedValue([mockTargetEvent]),
      getItinerary: vi.fn().mockResolvedValue({
        id: 'itin-riyadh-001',
        title: 'Saudi Cultural Journey',
        guest_count: 3,
        tenantId: testTenantId,
      }),
      getTravelerProfile: vi.fn().mockResolvedValue(null),
      getSnapshots: vi.fn().mockResolvedValue([]),
      updateEvent: vi.fn().mockResolvedValue(true),
      rollbackEvent: vi.fn().mockResolvedValue(undefined),
      executeAtomicCascade: vi.fn().mockResolvedValue({
        success: false,
        updatedEventsCount: 0,
        stagedOutboxNotices: [],
        error: 'OCC Conflict: target itinerary event row version was modified by another transaction',
      }),
    };

    const supplierRepo: SupplierRepository = {
      findProviderByPhone: vi.fn().mockResolvedValue(mockProviders[0]),
      getProviders: vi.fn().mockResolvedValue(mockProviders),
    };

    const notificationGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const llmProvider: LLMProvider = {
      generateJson: vi.fn().mockResolvedValue({
        data: {
          delayMinutes: 30,
          incidentType: 'delay',
          isCascadeImpact: false,
          incidentSummary: 'Concurrent shift attempt',
          scheduleAdjustments: [
            {
              eventId: 'evt-morning-tour',
              eventTitle: 'Diriyah Historical Tour',
              previousStartTime: '09:00',
              previousEndTime: '11:30',
              newStartTime: '09:30',
              newEndTime: '12:00',
              newStatus: 'escalated',
              reason: 'Shift during race',
            },
          ],
          downstreamNotices: [],
        },
      }),
    };

    const orchestrator = new TravelOperationsOrchestrator({
      llmProvider,
      itineraryRepo,
      supplierRepo,
      notificationGateway,
    });

    const result = await orchestrator.orchestrateCascade({
      eventId: 'evt-morning-tour',
      vendorMessage: 'تأخير نص ساعة',
      senderPhone: '966512345678',
      tenantId: testTenantId,
    });

    expect(result.success).toBe(false);
    expect(result.rollbackOccurred).toBe(true);
    expect(result.error).toContain('OCC Conflict');
    expect(notificationGateway.dispatchOutbox).not.toHaveBeenCalled();
  });

  it('scenario 5: preserves business transaction when observability collector is completely unreachable', async () => {
    const originalFetch = global.fetch;
    global.fetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes('v1/traces') || urlStr.includes('collector')) {
        throw new Error('ECONNREFUSED: OTLP Collector port 4318 unavailable');
      }
      return { ok: true, status: 200, json: async () => ({}) };
    });

    try {
      const exporter = new OtelHttpSpanExporter({
        endpoint: 'http:' + String.fromCharCode(47, 47) + 'localhost:4318/v1/traces',
        timeoutMs: 50,
        maxRetries: 1,
        retryBackoffBaseMs: 5,
      });

      const processor = new BatchSpanProcessor({
        exporter,
        maxQueueSize: 10,
        maxBatchSize: 2,
        scheduledDelayMillis: 0,
      });

      const tracer = new AgentTracer({
        tenantId: testTenantId,
      });

      const span = tracer.startSpan('resilience_operation', 'reasoning');
      tracer.endSpan(span, { status: 'healthy' });

      for (const s of tracer.toOtelSpans()) {
        processor.onEmit(s);
      }

      await expect(processor.flushBatch()).resolves.not.toThrow();

      const itineraryRepo: ItineraryRepository = {
        getTargetEvent: vi.fn().mockResolvedValue(mockTargetEvent),
        getDayEvents: vi.fn().mockResolvedValue([mockTargetEvent]),
        getItinerary: vi.fn().mockResolvedValue({
          id: 'itin-riyadh-001',
          title: 'Saudi Cultural Journey',
          guest_count: 2,
          tenantId: testTenantId,
        }),
        getTravelerProfile: vi.fn().mockResolvedValue(null),
        getSnapshots: vi.fn().mockResolvedValue([]),
        updateEvent: vi.fn().mockResolvedValue(true),
        rollbackEvent: vi.fn().mockResolvedValue(undefined),
        executeAtomicCascade: vi.fn().mockResolvedValue({
          success: true,
          updatedEventsCount: 1,
          stagedOutboxNotices: [],
        }),
      };

      const supplierRepo: SupplierRepository = {
        findProviderByPhone: vi.fn().mockResolvedValue(mockProviders[0]),
        getProviders: vi.fn().mockResolvedValue(mockProviders),
      };

      const notificationGateway: NotificationGateway = {
        sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
        stageOutbox: vi.fn().mockResolvedValue([]),
        dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
        fetchPendingOutbox: vi.fn().mockResolvedValue([]),
      };

      const llmProvider: LLMProvider = {
        generateJson: vi.fn().mockResolvedValue({
          data: {
            delayMinutes: 15,
            incidentType: 'delay',
            isCascadeImpact: false,
            incidentSummary: 'Collector down test',
            scheduleAdjustments: [
              {
                eventId: 'evt-morning-tour',
                eventTitle: 'Diriyah Historical Tour',
                previousStartTime: '09:00',
                previousEndTime: '11:30',
                newStartTime: '09:15',
                newEndTime: '11:45',
                newStatus: 'escalated',
                reason: 'Normal adjustment while collector down',
              },
            ],
            downstreamNotices: [],
          },
        }),
      };

      const orchestrator = new TravelOperationsOrchestrator({
        llmProvider,
        itineraryRepo,
        supplierRepo,
        notificationGateway,
      });

      const result = await orchestrator.orchestrateCascade({
        eventId: 'evt-morning-tour',
        vendorMessage: 'تأخير بسيط 15 دقيقة',
        senderPhone: '966512345678',
        tenantId: testTenantId,
      });

      expect(result.success).toBe(true);
      expect(result.updatedEventsCount).toBe(1);
      expect(itineraryRepo.executeAtomicCascade).toHaveBeenCalledTimes(1);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it('scenario 6: blocks unauthorized vendor phone at perimeter and prevents database corruption', async () => {
    const itineraryRepo: ItineraryRepository = {
      getTargetEvent: vi.fn().mockResolvedValue(mockTargetEvent),
      getDayEvents: vi.fn().mockResolvedValue([mockTargetEvent]),
      getItinerary: vi.fn().mockResolvedValue({
        id: 'itin-riyadh-001',
        title: 'Saudi Cultural Journey',
        guest_count: 2,
        tenantId: testTenantId,
      }),
      getTravelerProfile: vi.fn().mockResolvedValue(null),
      getSnapshots: vi.fn().mockResolvedValue([]),
      updateEvent: vi.fn().mockResolvedValue(true),
      rollbackEvent: vi.fn().mockResolvedValue(undefined),
      executeAtomicCascade: vi.fn(),
    };

    const supplierRepo: SupplierRepository = {
      findProviderByPhone: vi.fn().mockResolvedValue(null),
      getProviders: vi.fn().mockResolvedValue(mockProviders),
    };

    const notificationGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 0, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const llmProvider: LLMProvider = {
      generateJson: vi.fn(),
    };

    const recordedAudits: AgentAuditEntry[] = [];
    const auditLog: AuditLogPort = {
      record: vi.fn().mockImplementation(async (entry) => {
        recordedAudits.push(entry);
        return { success: true, persistedToDb: true, operationId: entry.operationId };
      }),
    };

    const orchestrator = new TravelOperationsOrchestrator({
      llmProvider,
      itineraryRepo,
      supplierRepo,
      notificationGateway,
      auditLog,
    });

    const unauthorizedPhone = '966588888888';
    const result = await orchestrator.orchestrateCascade({
      eventId: 'evt-morning-tour',
      vendorMessage: 'أنا بغير موعد الرحلة',
      senderPhone: unauthorizedPhone,
      tenantId: testTenantId,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Semantic Authorization Block');
    expect(llmProvider.generateJson).not.toHaveBeenCalled();
    expect(itineraryRepo.executeAtomicCascade).not.toHaveBeenCalled();
    expect(recordedAudits.length).toBe(1);
    expect(recordedAudits[0].operationType).toBe('action_boundary_block');
    expect(recordedAudits[0].rationale).toContain('Unauthorized access attempt');
    expect(recordedAudits[0].senderPhone).toBe(unauthorizedPhone);
  });
});
