import { describe, it, expect, vi, beforeEach } from 'vitest';
import { orchestrateItineraryCascade, OrchestrationDependencies } from '@/lib/whatsapp/orchestrator';
import { ItineraryRepository, SupplierRepository } from '@/lib/ports/repository.port';
import { NotificationGateway } from '@/lib/ports/notification.port';
import { LLMProvider } from '@/lib/ports/llm.port';
import { clearAuditLogs, getRecentAgentAuditLogs } from '@/lib/agent/audit-log';

describe('Domain Semantic Authorization & Transactional Atomicity', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearAuditLogs();
  });

  const mockTargetEvent = {
    id: 'evt-heritage-01',
    itinerary_id: 'itin-main-01',
    tenant_id: 'tenant-saudi-dmc',
    event_date: '2026-11-10',
    start_time: '10:00:00',
    end_time: '12:00:00',
    title: 'Historic AlUla Oasis Tour',
    status: 'confirmed',
    sort_order: 1,
    experience_provider_id: 'prov-authorized-guide',
  };

  const mockDayEvents = [
    mockTargetEvent,
    {
      id: 'evt-heritage-02',
      itinerary_id: 'itin-main-01',
      tenant_id: 'tenant-saudi-dmc',
      event_date: '2026-11-10',
      start_time: '14:00:00',
      end_time: '16:00:00',
      title: 'Elephant Rock Sunset',
      status: 'confirmed',
      sort_order: 2,
      experience_provider_id: 'prov-sunset-team',
    },
  ];

  const mockProviders = [
    {
      id: 'prov-authorized-guide',
      name: 'Guide Mansour',
      phone_number: '966511111111',
      tenant_id: 'tenant-saudi-dmc',
    },
    {
      id: 'prov-unauthorized-supplier',
      name: 'Other Supplier',
      phone_number: '966599999999',
      tenant_id: 'tenant-saudi-dmc',
    },
  ];

  function createMockDependencies(overrides?: {
    atomicCascadeSuccess?: boolean;
    atomicCascadeError?: string;
  }): OrchestrationDependencies {
    const itineraryRepo: ItineraryRepository = {
      getTargetEvent: vi.fn().mockResolvedValue(mockTargetEvent),
      getDayEvents: vi.fn().mockResolvedValue(mockDayEvents),
      getItinerary: vi.fn().mockResolvedValue({
        id: 'itin-main-01',
        title: 'AlUla Experience',
        guest_count: 4,
        traveler_profile_id: 'prof-01',
        tenant_id: 'tenant-saudi-dmc',
      }),
      getTravelerProfile: vi.fn().mockResolvedValue({
        id: 'prof-01',
        nationality: 'British',
        group_size: 4,
        tenant_id: 'tenant-saudi-dmc',
      }),
      getSnapshots: vi.fn().mockResolvedValue([]),
      updateEvent: vi.fn().mockResolvedValue(true),
      rollbackEvent: vi.fn().mockResolvedValue(undefined),
      executeAtomicCascade: vi.fn().mockImplementation(async (params) => {
        if (overrides?.atomicCascadeSuccess === false) {
          return {
            success: false,
            updatedEventsCount: 0,
            stagedOutboxNotices: [],
            error: overrides.atomicCascadeError || 'Database Constraint Failure',
          };
        }
        return {
          success: true,
          updatedEventsCount: params.adjustments.length,
          stagedOutboxNotices: params.outboxNotices.map((n: any) => ({
            id: 'mock-outbox-id',
            tenantId: params.tenantId,
            eventId: n.eventId,
            providerName: n.providerName,
            providerPhone: n.providerPhone,
            message: n.message,
            status: 'pending' as const,
            attempts: 0,
          })),
        };
      }),
    };

    const supplierRepo: SupplierRepository = {
      findProviderByPhone: vi.fn().mockImplementation(async (phone) => {
        const found = mockProviders.find((p) => p.phone_number === phone);
        return found || null;
      }),
      getProviders: vi.fn().mockResolvedValue(mockProviders),
    };

    const notificationGateway: NotificationGateway = {
      sendTextMessage: vi.fn().mockResolvedValue({ success: true, messageId: 'msg-001' }),
      stageOutbox: vi.fn().mockResolvedValue([]),
      dispatchOutbox: vi.fn().mockResolvedValue({ dispatchedCount: 1, updatedNotices: [] }),
      fetchPendingOutbox: vi.fn().mockResolvedValue([]),
    };

    const llmProvider: LLMProvider = {
      generateJson: vi.fn().mockResolvedValue({
        data: {
          delayMinutes: 60,
          incidentType: 'delay',
          isCascadeImpact: false,
          incidentSummary: 'Traffic delay resolved',
          scheduleAdjustments: [
            {
              eventId: 'evt-heritage-01',
              eventTitle: 'Historic AlUla Oasis Tour',
              previousStartTime: '10:00',
              previousEndTime: '12:00',
              newStartTime: '11:00',
              newEndTime: '13:00',
              newStatus: 'escalated',
              reason: 'Traffic congestion',
            },
          ],
          downstreamNotices: [],
        },
        raw: '{}',
        model: 'test-model',
        latencyMs: 120,
      }),
    };

    return {
      itineraryRepo,
      supplierRepo,
      notificationGateway,
      llmProvider,
    };
  }

  it('rejects an unauthorized sender phone at the application orchestrator boundary', async () => {
    const deps = createMockDependencies();

    const result = await orchestrateItineraryCascade(
      {
        eventId: 'evt-heritage-01',
        vendorMessage: 'تأخرنا نصف ساعة بسبب الزحام',
        senderPhone: '966599999999',
        tenantId: 'tenant-saudi-dmc',
      },
      deps
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Semantic Authorization Block');
    expect(result.updatedEventsCount).toBe(0);
    expect(deps.itineraryRepo?.executeAtomicCascade).not.toHaveBeenCalled();

    const logs = getRecentAgentAuditLogs(5);
    const blockedLog = logs.find((l) => l.operationType === 'action_boundary_block');
    expect(blockedLog).toBeDefined();
    expect(blockedLog?.validationStatus).toBe('rejected');
    expect(blockedLog?.violations?.[0]).toContain('Semantic Authorization Block');
  });

  it('rejects an unregistered phone number attempting to alter an itinerary', async () => {
    const deps = createMockDependencies();

    const result = await orchestrateItineraryCascade(
      {
        eventId: 'evt-heritage-01',
        vendorMessage: 'تأخرنا نصف ساعة',
        senderPhone: '966500000999',
        tenantId: 'tenant-saudi-dmc',
      },
      deps
    );

    expect(result.success).toBe(false);
    expect(result.error).toContain('Semantic Authorization Block');
    expect(deps.itineraryRepo?.executeAtomicCascade).not.toHaveBeenCalled();
  });

  it('permits authorized supplier and executes atomic cascade transaction', async () => {
    const deps = createMockDependencies();

    const result = await orchestrateItineraryCascade(
      {
        eventId: 'evt-heritage-01',
        vendorMessage: 'تأخرنا ساعة بسبب عطل فني في السيارة',
        senderPhone: '966511111111',
        tenantId: 'tenant-saudi-dmc',
      },
      deps
    );

    expect(result.success).toBe(true);
    expect(result.updatedEventsCount).toBe(1);
    expect(deps.itineraryRepo?.executeAtomicCascade).toHaveBeenCalledTimes(1);
    expect(deps.notificationGateway?.dispatchOutbox).toHaveBeenCalledTimes(1);
  });

  it('handles atomic cascade rollback cleanly when transaction fails', async () => {
    const deps = createMockDependencies({
      atomicCascadeSuccess: false,
      atomicCascadeError: 'PostgreSQL deadlock aborted',
    });

    const result = await orchestrateItineraryCascade(
      {
        eventId: 'evt-heritage-01',
        vendorMessage: 'تأخرنا ساعة',
        senderPhone: '966511111111',
        tenantId: 'tenant-saudi-dmc',
      },
      deps
    );

    expect(result.success).toBe(false);
    expect(result.rollbackOccurred).toBe(true);
    expect(result.error).toContain('Transaction rolled back due to update error');
    expect(deps.notificationGateway?.dispatchOutbox).not.toHaveBeenCalled();
  });
});
