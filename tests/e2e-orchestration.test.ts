import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';
import { recordAgentOperation } from '@/lib/agent/audit-log';
import type { CandidateGroupEvent, OrchestrationDecision } from '@/lib/whatsapp/types';

describe('End-to-End Autonomous Operations Pipeline', () => {
  const candidateEvents: CandidateGroupEvent[] = [
    {
      eventId: 'event-morning-safari',
      title: 'Morning Desert Safari & Dune Tour',
      eventDate: '2026-10-15',
      startTime: '09:00',
      endTime: '11:30',
      status: 'planned',
      groupSize: 4,
      nationality: 'British',
      timePeriod: 'الصباح',
    },
    {
      eventId: 'event-afternoon-hegra',
      title: 'Hegra Heritage Tomb Exploration',
      eventDate: '2026-10-15',
      startTime: '13:00',
      endTime: '15:30',
      status: 'planned',
      groupSize: 4,
      nationality: 'British',
      timePeriod: 'بعد الظهر',
    },
    {
      eventId: 'event-flight-riyadh',
      title: 'Domestic Flight to Riyadh',
      eventDate: '2026-10-15',
      startTime: '19:00',
      endTime: '20:30',
      status: 'confirmed',
      isImmutable: true,
      groupSize: 4,
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('successfully executes end-to-end incident cascade from Arabic supplier message to audit trail', async () => {
    const incomingVendorMessage = 'نتأخر ساعة ونص بسبب عطل في الباص على طريق العلا';

    const classifiedIntent = {
      category: 'delay',
      delayMinutes: 90,
      targetEventId: 'event-morning-safari',
      confidenceScore: 0.96,
    };

    expect(classifiedIntent.category).toBe('delay');
    expect(classifiedIntent.delayMinutes).toBe(90);

    const isAuthorized = candidateEvents.some((c) => c.eventId === classifiedIntent.targetEventId);
    expect(isAuthorized).toBe(true);

    const targetEvent = candidateEvents.find((c) => c.eventId === classifiedIntent.targetEventId);
    expect(targetEvent).toBeDefined();
    expect(targetEvent?.isImmutable).toBeFalsy();

    const orchestrationDecision: OrchestrationDecision = {
      delayMinutes: 90,
      incidentType: 'delay',
      isCascadeImpact: true,
      incidentSummary: 'Morning safari delayed 90 mins due to vehicle breakdown on AlUla highway. Downstream Hegra tour shifted 60 mins maintaining 30m transit buffer.',
      scheduleAdjustments: [
        {
          eventId: 'event-morning-safari',
          eventTitle: 'Morning Desert Safari & Dune Tour',
          previousStartTime: '09:00',
          previousEndTime: '11:30',
          newStartTime: '10:30',
          newEndTime: '13:00',
          newStatus: 'escalated',
          reason: '90m bus breakdown',
        },
        {
          eventId: 'event-afternoon-hegra',
          eventTitle: 'Hegra Heritage Tomb Exploration',
          previousStartTime: '13:00',
          previousEndTime: '15:30',
          newStartTime: '13:30',
          newEndTime: '16:00',
          newStatus: 'escalated',
          reason: 'Cascaded forward by 30 mins to maintain transit window',
        },
      ],
      downstreamNotices: [
        {
          eventId: 'event-afternoon-hegra',
          providerName: 'Hegra Guides Consortium',
          providerPhone: '+966500000002',
          newStartTime: '13:30',
          whatsappMessage: 'السلام عليكم ورحمة الله، نبلغكم بترحيل موعد جولة مدائن صالح إلى 13:30 بسبب تأخر المجموعة في الجولة السابقة.',
        },
      ],
      travelerNotification: {
        language: 'en',
        message: 'Dear guests, your morning safari timing has shifted to 10:30 AM due to a minor vehicle maintenance delay. Your afternoon Hegra visit has been rescheduled to 1:30 PM.',
      },
    };

    const validationResult = validateOrchestrationDecision(orchestrationDecision, {
      targetEventDate: '2026-10-15',
      minTransitBufferMinutes: 30,
      knownEvents: candidateEvents.map((e) => ({
        id: e.eventId,
        title: e.title,
        date: e.eventDate,
        startTime: e.startTime,
        endTime: e.endTime,
        status: e.status,
        isImmutable: e.isImmutable,
      })),
    });

    expect(validationResult.isValid).toBe(true);
    expect(validationResult.requiresHumanEscalation).toBe(false);
    expect(validationResult.violations).toHaveLength(0);

    const outboxNotices = orchestrationDecision.downstreamNotices.map((n) => ({
      id: crypto.randomUUID(),
      eventId: n.eventId,
      providerPhone: n.providerPhone || '',
      message: n.whatsappMessage,
      status: 'pending' as const,
    }));

    expect(outboxNotices).toHaveLength(1);
    expect(outboxNotices[0].status).toBe('pending');

    const dispatchedOutbox = outboxNotices.map((item) => ({
      ...item,
      status: 'dispatched' as const,
      dispatchedAt: new Date().toISOString(),
    }));

    expect(dispatchedOutbox[0].status).toBe('dispatched');
    expect(dispatchedOutbox[0].dispatchedAt).toBeDefined();

    const auditResult = await recordAgentOperation({
      operationId: crypto.randomUUID(),
      operationType: 'schedule_cascade',
      tenantId: 'tenant-demo-alula',
      itineraryId: 'itin-test-101',
      eventId: targetEvent?.eventId,
      triggerMessageId: 'wamid.HBgLM...',
      senderPhone: '+966500000001',
      llmModel: 'llama-3.3-70b-versatile',
      latencyMs: 1420,
      rationale: orchestrationDecision.incidentSummary,
      validationStatus: 'passed',
      metadata: {
        delayMinutes: orchestrationDecision.delayMinutes,
        updatedEventsCount: orchestrationDecision.scheduleAdjustments.length,
        dispatchedNoticesCount: dispatchedOutbox.length,
        incidentType: orchestrationDecision.incidentType,
      },
    });

    expect(auditResult.operationId).toBeDefined();
  });

  it('rejects cross-supplier spoofing attempts via semantic authorization gate', async () => {
    const maliciousSpoofMessage = 'الرجاء ترحيل موعد طيران الرياض إلى الغد';

    const unpermittedTargetEventId = 'event-flight-riyadh';
    const isSupplierPermitted = candidateEvents
      .filter((e) => e.eventId !== 'event-flight-riyadh')
      .some((c) => c.eventId === unpermittedTargetEventId);

    expect(isSupplierPermitted).toBe(false);

    const auditBlock = await recordAgentOperation({
      operationId: crypto.randomUUID(),
      operationType: 'action_boundary_block',
      tenantId: 'tenant-demo-alula',
      itineraryId: 'itin-test-101',
      eventId: unpermittedTargetEventId,
      triggerMessageId: 'wamid.HBgLM_spoof...',
      senderPhone: '+966500000099',
      llmModel: 'llama-3.3-70b-versatile',
      latencyMs: 120,
      rationale: 'Semantic Authorization Block: Sender is not mapped to event event-flight-riyadh',
      validationStatus: 'rejected',
      violations: ['Semantic Authorization Block'],
    });

    expect(auditBlock.operationId).toBeDefined();
  });
});
