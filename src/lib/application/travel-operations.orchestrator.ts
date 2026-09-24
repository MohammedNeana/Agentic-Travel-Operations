import {
  OrchestrationDecision,
  OrchestrationExecutionResult,
  ScheduleAdjustment,
  DownstreamVendorNotice,
} from '@/lib/whatsapp/types';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';
import { AuditLogPort, AgentAuditEntry } from '@/lib/ports/audit-log.port';
import { AgentTracer } from '@/lib/observability/telemetry';
import { LLMProvider } from '@/lib/ports/llm.port';
import {
  ItineraryRepository,
  SupplierRepository,
  AtomicCascadeAdjustment,
  AtomicCascadeOutboxNotice,
} from '@/lib/ports/repository.port';
import { NotificationGateway } from '@/lib/ports/notification.port';

export interface TravelOperationsOrchestratorDependencies {
  readonly llmProvider: LLMProvider;
  readonly itineraryRepo: ItineraryRepository;
  readonly supplierRepo: SupplierRepository;
  readonly notificationGateway: NotificationGateway;
  readonly auditLog?: AuditLogPort;
}

export interface OrchestrationRequest {
  eventId: string;
  vendorMessage: string;
  senderPhone?: string;
  triggerMessageId?: string;
  tenantId?: string;
}

export class TravelOperationsOrchestrator {
  constructor(private readonly deps: TravelOperationsOrchestratorDependencies) {}

  async orchestrateCascade(options: OrchestrationRequest): Promise<OrchestrationExecutionResult> {
    const { eventId, vendorMessage } = options;

    const targetEvent = await this.deps.itineraryRepo.getTargetEvent(eventId, options.tenantId);

    if (!targetEvent) {
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: `Event ${eventId} not found in database.`,
      };
    }

    const tenantId = options.tenantId || targetEvent.tenant_id;

    const tracer = new AgentTracer({
      tenantId,
      triggerMessageId: options.triggerMessageId,
      senderPhone: options.senderPhone,
    });

    const providers = await this.deps.supplierRepo.getProviders(tenantId);

    if (options.senderPhone) {
      const normalizedSender = options.senderPhone.replace(/\D/g, '');
      const senderProvider =
        providers.find((p) => (p.phone_number || '').replace(/\D/g, '') === normalizedSender) ||
        (await this.deps.supplierRepo.findProviderByPhone(options.senderPhone, tenantId));

      const isAuthorized =
        senderProvider && senderProvider.id === targetEvent.experience_provider_id;

      if (!isAuthorized) {
        const authViolation = `Semantic Authorization Block: Sender ${options.senderPhone} is not authorized for target event ${targetEvent.id}.`;
        if (this.deps.auditLog) {
          await this.deps.auditLog.record({
            operationId: tracer.getContext().agentRunId,
            operationType: 'action_boundary_block',
            tenantId,
            itineraryId: targetEvent.itinerary_id,
            eventId: targetEvent.id,
            triggerMessageId: options.triggerMessageId,
            senderPhone: options.senderPhone,
            latencyMs: tracer.getTotalDurationMs(),
            rationale: `Unauthorized access attempt from sender phone ${options.senderPhone}`,
            validationStatus: 'rejected',
            violations: [authViolation],
            metadata: {
              traceId: tracer.getContext().traceId,
              traceparent: tracer.toTraceparent(),
              spans: tracer.getSpans(),
            },
          });
        }

        return {
          success: false,
          updatedEventsCount: 0,
          dispatchedNoticesCount: 0,
          error: authViolation,
          incidentSummary: authViolation,
          validationViolations: [authViolation],
        };
      }
    }

    const allEvents = await this.deps.itineraryRepo.getDayEvents(
      targetEvent.itinerary_id,
      targetEvent.event_date,
      tenantId
    );

    if (!allEvents || allEvents.length === 0) {
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: 'Failed to fetch itinerary events.',
      };
    }

    const itineraryData = await this.deps.itineraryRepo.getItinerary(targetEvent.itinerary_id, tenantId);

    let travelerNationality = 'دولي';
    let groupSize = itineraryData?.guest_count || 2;

    if (itineraryData?.traveler_profile_id) {
      const profileData = await this.deps.itineraryRepo.getTravelerProfile(
        itineraryData.traveler_profile_id,
        tenantId
      );
      if (profileData) {
        travelerNationality = profileData.nationality || travelerNationality;
        groupSize = profileData.group_size || groupSize;
      }
    }

    const enrichedEvents = allEvents.map((ev, index) => {
      const prov = providers?.find((p) => p.id === ev.experience_provider_id);
      const isImmutable =
        Boolean(ev.is_immutable) ||
        new RegExp('flight|طيران|مطار|airport|border|منفذ|قطار|train', 'i').test(ev.title);
      return {
        order: index + 1,
        eventId: ev.id,
        title: ev.title,
        date: ev.event_date,
        startTime: (ev.start_time || '10:00').substring(0, 5),
        endTime: (ev.end_time || '13:00').substring(0, 5),
        status: ev.status,
        providerName: prov?.name || ev.title,
        providerPhone: prov?.phone_number || '',
        isTargetEvent: ev.id === targetEvent.id,
        isImmutable,
      };
    });

    const apiKey = process.env.GROQ_API_KEY;
    const model = process.env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile';

    let decision: OrchestrationDecision;
    const reasoningSpan = tracer.startSpan('consult_llm_orchestrator', 'reasoning');

    try {
      decision = await this.consultLLM({
        targetEventId: targetEvent.id,
        vendorMessage,
        enrichedEvents,
        travelerNationality,
        groupSize,
        model,
      });
    } catch {
      decision = this.fallbackDecision({
        targetEvent,
        allEvents: enrichedEvents,
        vendorMessage,
        travelerNationality,
        groupSize,
      });
    }
    tracer.endSpan(reasoningSpan, { model, isCascade: decision.isCascadeImpact });

    const validationSpan = tracer.startSpan('validate_orchestration_decision', 'validation');
    const validation = validateOrchestrationDecision(decision, {
      targetEventDate: targetEvent.event_date,
      knownEvents: enrichedEvents.map((e) => ({
        id: e.eventId,
        title: e.title,
        date: e.date,
        startTime: e.startTime,
        endTime: e.endTime,
        status: e.status,
        isImmutable: e.isImmutable,
      })),
      minTransitBufferMinutes: 30,
    });
    tracer.endSpan(validationSpan, { isValid: validation.isValid, violationCount: validation.violations.length });

    if (!validation.isValid || !validation.validatedDecision) {
      const escalationReason = `AI Action Boundary Block: Schedule adjustments rejected due to domain constraint violations: ${validation.violations.join('; ')}`;
      await this.deps.itineraryRepo.updateEvent(
        {
          id: targetEvent.id,
          startTime: targetEvent.start_time,
          endTime: targetEvent.end_time,
          status: 'escalated',
          escalationReason,
        },
        tenantId
      );

      if (this.deps.auditLog) {
        await this.deps.auditLog.record({
          operationId: tracer.getContext().agentRunId,
          operationType: 'action_boundary_block',
          tenantId,
          itineraryId: targetEvent.itinerary_id,
          eventId: targetEvent.id,
          triggerMessageId: options.triggerMessageId,
          senderPhone: options.senderPhone,
          llmModel: model,
          latencyMs: tracer.getTotalDurationMs(),
          rationale: vendorMessage,
          validationStatus: 'rejected',
          violations: validation.violations,
          metadata: {
            traceId: tracer.getContext().traceId,
            traceparent: tracer.toTraceparent(),
            spans: tracer.getSpans(),
          },
        });
      }

      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: escalationReason,
        incidentSummary: escalationReason,
        validationViolations: validation.violations,
      };
    }

    const validatedDecision = validation.validatedDecision;

    const adjustments: AtomicCascadeAdjustment[] = validatedDecision.scheduleAdjustments.map((adj) => {
      const startStr = adj.newStartTime.length === 5 ? `${adj.newStartTime}:00` : adj.newStartTime;
      const endStr = adj.newEndTime.length === 5 ? `${adj.newEndTime}:00` : adj.newEndTime;
      const baseReason = adj.reason || validatedDecision.incidentSummary;
      const fullReason = validatedDecision.travelerNotification
        ? `${baseReason} [${validatedDecision.travelerNotification.language}]: "${validatedDecision.travelerNotification.message}"`
        : baseReason;
      return {
        eventId: adj.eventId,
        startTime: startStr,
        endTime: endStr,
        status: adj.newStatus || 'escalated',
        escalationReason: fullReason,
      };
    });

    const rawNotices: AtomicCascadeOutboxNotice[] = validatedDecision.downstreamNotices
      .filter((n) => n.whatsappMessage && n.whatsappMessage.trim().length > 0)
      .map((notice) => ({
        eventId: notice.eventId,
        providerName: notice.providerName,
        providerPhone: notice.providerPhone || '',
        message: notice.whatsappMessage,
      }));

    const auditEntry: AgentAuditEntry = {
      operationId: tracer.getContext().agentRunId,
      operationType: 'schedule_cascade',
      tenantId,
      itineraryId: targetEvent.itinerary_id,
      eventId: targetEvent.id,
      triggerMessageId: options.triggerMessageId,
      senderPhone: options.senderPhone,
      llmModel: model,
      latencyMs: tracer.getTotalDurationMs(),
      rationale: validatedDecision.incidentSummary,
      validationStatus: 'passed',
      metadata: {
        traceId: tracer.getContext().traceId,
        traceparent: tracer.toTraceparent(),
        spans: tracer.getSpans(),
        otelSpans: tracer.toOtelSpans(),
        delayMinutes: validatedDecision.delayMinutes,
        incidentType: validatedDecision.incidentType,
        domainEvents: validation.domainEvents || [],
      },
    };

    const mutationSpan = tracer.startSpan('execute_atomic_cascade', 'mutation');
    const atomicResult = await this.deps.itineraryRepo.executeAtomicCascade({
      tenantId,
      adjustments,
      outboxNotices: rawNotices,
      auditEntry,
    });
    tracer.endSpan(mutationSpan, {
      success: atomicResult.success,
      updatedCount: atomicResult.updatedEventsCount,
      stagedCount: atomicResult.stagedOutboxNotices.length,
      error: atomicResult.error,
    });

    if (!atomicResult.success) {
      return {
        success: false,
        updatedEventsCount: 0,
        dispatchedNoticesCount: 0,
        error: `Transaction rolled back due to update error: ${atomicResult.error}`,
        incidentSummary: validatedDecision.incidentSummary,
        rollbackOccurred: true,
      };
    }

    const notificationSpan = tracer.startSpan('dispatch_downstream_notices', 'notification');
    const { dispatchedCount: dispatchedNoticesCount, updatedNotices: outboxNotices } =
      await this.deps.notificationGateway.dispatchOutbox(atomicResult.stagedOutboxNotices);
    tracer.endSpan(notificationSpan, { dispatchedCount: dispatchedNoticesCount });

    return {
      success: true,
      decision: validatedDecision,
      updatedEventsCount: atomicResult.updatedEventsCount,
      dispatchedNoticesCount,
      incidentSummary: validatedDecision.incidentSummary,
      travelerNotification: validatedDecision.travelerNotification,
      outboxNotices: outboxNotices.map((n) => ({
        id: n.id,
        tenantId: n.tenantId,
        eventId: n.eventId,
        providerName: n.providerName,
        providerPhone: n.providerPhone,
        message: n.message,
        status: n.status,
        attempts: n.attempts,
        createdAt: n.createdAt,
        dispatchedAt: n.dispatchedAt,
        error: n.error,
      })),
    };
  }

  private async consultLLM(params: {
    targetEventId: string;
    vendorMessage: string;
    enrichedEvents: Array<{
      order: number;
      eventId: string;
      title: string;
      date: string;
      startTime: string;
      endTime: string;
      status: string;
      providerName: string;
      providerPhone: string;
      isTargetEvent: boolean;
    }>;
    travelerNationality: string;
    groupSize: number;
    model?: string;
  }): Promise<OrchestrationDecision> {
    const { targetEventId, vendorMessage, enrichedEvents, travelerNationality, groupSize } = params;

    const targetEvent = enrichedEvents.find((e) => e.eventId === targetEventId);

    const scheduleDescription = enrichedEvents
      .map((e) => {
        const marker = e.isTargetEvent ? '[الفعالية المتأثرة بالبلاغ]' : `[الفعالية رقم ${e.order}]`;
        return `${marker}:
- معرف الفعالية: "${e.eventId}"
- اسم الفعالية: "${e.title}"
- المزود: "${e.providerName}" (هاتف: ${e.providerPhone || 'غير مسجل'})
- الموعد الأصلي: من الساعة ${e.startTime} إلى ${e.endTime} (التاريخ: ${e.date})
- الحالة الحالية: ${e.status}`;
      })
      .join('\n\n');

    const systemPrompt = `You are the Senior AI Operations Director & Dispatch Orchestrator for a premier Destination Management Company (DMC).
You operate with autonomous operational intelligence to manage trip schedules, resolve vendor delays, eliminate schedule conflicts, and coordinate downstream vendors.

You receive an operational WhatsApp message (text or voice transcription) from a provider regarding an activity in an active itinerary.
Guest Details: الوفد (${travelerNationality}) عددهم ${groupSize} أشخاص.

YOUR AUTONOMOUS MISSION:
1. UNDERSTAND DELAY & ROOT CAUSE:
   - Extract the delay duration (e.g. 2 hours, 90 minutes, 30 minutes, or a new stated start time like 16:00).
   - If not explicitly stated in hours/minutes, deduce the realistic delay from the vendor's context.

2. CASCADE IMPACT ANALYSIS ON SUBSEQUENT TRIPS:
   - Calculate the new start and end time for the target delayed event.
   - Look at the subsequent events in the itinerary.
   - Account for realistic travel/buffer time (at least 30 to 60 minutes) between destinations.
   - If the delayed event now ends after or too close to the start time of the next event, THERE IS A CONFLICT.
   - Calculate the new adjusted start and end time for each affected downstream event to prevent overlap.
   - Mark "isCascadeImpact": true if any subsequent event is affected.

3. DRAFT HUMAN-LIKE WHATSAPP NOTICES TO DOWNSTREAM VENDORS:
   - For every downstream vendor whose booking needs to be pushed forward:
     Draft a warm, courteous, and culturally authentic Arabic WhatsApp message written as the DMC Operations Coordinator.
      Requirements for each downstream message:
      - Tone: Professional, warm hospitality style ("السلام عليكم ورحمة الله، حياك الله أخوي [اسم المزود]، معك منسق العمليات في There DMC").
      - Inform them naturally that the group experienced an unexpected delay in their previous tour/activity.
      - State the updated estimated arrival time clearly ("نقّدر وصول الوفد لكم الساعة [الوقت الجديد] بدلاً من [الوقت الأصلي]").
      - Respect traveler privacy: mention group nationality and size, NEVER traveler personal names.
      - Include direct coordination assurance ("نعتذر عن أي إرباك ونقدّر مرونتكم العالية معنا، وسيتم احتساب أي تكاليف إضافية إن وُجدت").

4. DRAFT TRAVELER MULTILINGUAL NOTIFICATION:
   - Draft a reassuring notification directed to the travelers in their native language based on their nationality (${travelerNationality}):
     * If German: German ("Sehr geehrte Gäste...")
     * If Italian: Italian ("Gentili ospiti...")
     * If French: French ("Chers invités...")
     * If Japanese: Japanese ("お客様へ...")
     * If British / American / International: English ("Dear Valued Guests...")
     * If Arab: Formal Arabic ("ضيوفنا الكرام...")
   - Always provide "translatedSummaryInArabic" alongside it for internal DMC records.

Respond ONLY with a valid JSON object matching this schema:
{
  "delayMinutes": 120,
  "incidentType": "delay" | "breakdown" | "traffic" | "weather" | "general",
  "isCascadeImpact": true,
  "incidentSummary": "ملخص تنفيذي بالعربية يوضح سبب التأخير والإجراءات المتخذة لإعادة جدولة اليوم بدون تضارب...",
  "scheduleAdjustments": [
    {
      "eventId": "uuid-here",
      "eventTitle": "عنوان الفعالية",
      "previousStartTime": "14:00",
      "previousEndTime": "17:00",
      "newStartTime": "16:00",
      "newEndTime": "19:00",
      "newStatus": "escalated",
      "reason": "تأخير ساعتين في الفعالية السابقة أدى لترحيل الموعد لضمان عدم التضارب"
    }
  ],
  "downstreamNotices": [
    {
      "eventId": "downstream-event-uuid",
      "providerName": "اسم المزود المتأثر",
      "providerPhone": "رقم الهاتف أو فارغ",
      "newStartTime": "19:30",
      "whatsappMessage": "السلام عليكم ورحمة الله، حياك الله أخوي..."
    }
  ],
  "travelerNotification": {
    "language": "German",
    "flag": "🇩🇪",
    "title": "Tour Schedule Update",
    "message": "Localized message in traveler native language...",
    "translatedSummaryInArabic": "الملخص بالعربية لمنسق الرحلة..."
  }
}`;

    const userPrompt = `رسالة المزود الواردة (النصية أو الصوتية):
"${vendorMessage}"

الفعالية المعنية: "${targetEvent?.title || 'الفعالية'}" (الموعد: ${targetEvent?.startTime} - ${targetEvent?.endTime})
جدول الرحلة الكامل لهذا اليوم:
${scheduleDescription}`;

    const result = await this.deps.llmProvider.generateJson<OrchestrationDecision>({
      systemPrompt,
      userPrompt,
      temperature: 0.1,
    });

    const parsed = result.data;

    return {
      delayMinutes: typeof parsed.delayMinutes === 'number' ? parsed.delayMinutes : 60,
      incidentType: parsed.incidentType || 'delay',
      isCascadeImpact: Boolean(parsed.isCascadeImpact),
      incidentSummary: parsed.incidentSummary || 'تم ترحيل الجدول تلقائياً بالذكاء الاصطناعي لتفادي التضارب.',
      scheduleAdjustments: Array.isArray(parsed.scheduleAdjustments) ? parsed.scheduleAdjustments : [],
      downstreamNotices: Array.isArray(parsed.downstreamNotices) ? parsed.downstreamNotices : [],
      travelerNotification: parsed.travelerNotification || undefined,
    };
  }

  private fallbackDecision(params: {
    targetEvent: {
      id: string;
      title: string;
      start_time: string;
      end_time: string;
    };
    allEvents: Array<{
      order: number;
      eventId: string;
      title: string;
      date?: string;
      startTime: string;
      endTime: string;
      status: string;
      providerName: string;
      providerPhone: string;
      isTargetEvent: boolean;
    }>;
    vendorMessage: string;
    travelerNationality: string;
    groupSize: number;
  }): OrchestrationDecision {
    const { targetEvent, allEvents, vendorMessage, travelerNationality, groupSize } = params;

    let delayMinutes = 60;
    const numMatch = vendorMessage.match(new RegExp('(\\d+)\\s*(دقيقة|ساعة|ساعات|دقايق|h|hr|min|hours?|mins?)', 'i'));
    if (numMatch) {
      const val = parseInt(numMatch[1], 10);
      const unit = numMatch[2].toLowerCase();
      if (unit.startsWith('ساع') || unit.startsWith('h')) {
        delayMinutes = val * 60;
      } else {
        delayMinutes = val;
      }
    } else if (new RegExp('ساعتين', 'i').test(vendorMessage)) {
      delayMinutes = 120;
    } else if (new RegExp('نص ساعة|نصف ساعة', 'i').test(vendorMessage)) {
      delayMinutes = 30;
    }

    function addMinutesToTime(timeStr: string, mins: number): string {
      const parts = (timeStr || '10:00').split(':').map((v) => parseInt(v, 10));
      const total = (isNaN(parts[0]) ? 10 : parts[0]) * 60 + (isNaN(parts[1]) ? 0 : parts[1]) + mins;
      const capped = Math.min(total, 23 * 60 + 45);
      const newH = Math.floor(capped / 60);
      const newM = capped % 60;
      return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
    }

    function parseToMins(t: string): number {
      const p = (t || '00:00').split(':').map((x) => parseInt(x, 10));
      return (isNaN(p[0]) ? 0 : p[0]) * 60 + (isNaN(p[1]) ? 0 : p[1]);
    }

    const scheduleAdjustments: ScheduleAdjustment[] = [];
    const downstreamNotices: DownstreamVendorNotice[] = [];

    const targetNewStart = addMinutesToTime(targetEvent.start_time, delayMinutes);
    const targetNewEnd = addMinutesToTime(targetEvent.end_time, delayMinutes);

    scheduleAdjustments.push({
      eventId: targetEvent.id,
      eventTitle: targetEvent.title,
      previousStartTime: targetEvent.start_time ? targetEvent.start_time.substring(0, 5) : '10:00',
      previousEndTime: targetEvent.end_time ? targetEvent.end_time.substring(0, 5) : '13:00',
      newStartTime: targetNewStart,
      newEndTime: targetNewEnd,
      newStatus: 'escalated',
      reason: `تأخير تشغيلي قدره ${delayMinutes} دقيقة بناءً على بلاغ المزود عبر واتساب.`,
    });

    const subsequentEvents = allEvents.filter((e) => !e.isTargetEvent && e.order > 1);
    let lastEndTimeMins = parseToMins(targetNewEnd);
    let isCascade = false;

    for (const sub of subsequentEvents) {
      const origStartMins = parseToMins(sub.startTime);
      const origEndMins = parseToMins(sub.endTime);
      const duration = origEndMins - origStartMins;
      const minBuffer = 30;

      if (lastEndTimeMins + minBuffer > origStartMins) {
        isCascade = true;
        const newStartMins = lastEndTimeMins + minBuffer;
        const newEndMins = newStartMins + (duration > 0 ? duration : 120);

        const toTimeStr = (totalMins: number) => {
          const capped = Math.min(totalMins, 23 * 60 + 45);
          const h = Math.floor(capped / 60);
          const m = capped % 60;
          return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
        };

        const adjustedStart = toTimeStr(newStartMins);
        const adjustedEnd = toTimeStr(newEndMins);

        scheduleAdjustments.push({
          eventId: sub.eventId,
          eventTitle: sub.title,
          previousStartTime: sub.startTime,
          previousEndTime: sub.endTime,
          newStartTime: adjustedStart,
          newEndTime: adjustedEnd,
          newStatus: 'escalated',
          reason: `ترحيل وقائي لتفادي التضارب مع الفعالية السابقة مع ضمان وقت تنقل لا يقل عن ${minBuffer} دقيقة.`,
        });

        downstreamNotices.push({
          eventId: sub.eventId,
          providerName: sub.providerName,
          providerPhone: sub.providerPhone,
          newStartTime: adjustedStart,
          whatsappMessage: `السلام عليكم ورحمة الله، حياك الله أخوي ${sub.providerName}، معك منسق العمليات في There DMC. نود إبلاغكم بأن الوفد (${travelerNationality} - عدد ${groupSize} أشخاص) واجه تأخيراً في جولته السابقة. يرجى التكرم بتأجيل الموعد ليكون وصولهم المتوقع عند الساعة ${adjustedStart} بإذن الله. نعتذر عن أي إرباك ونقدّر مرونتكم العالية معنا، وسيتم احتساب أي تكاليف إضافية إن وُجدت.`,
        });

        lastEndTimeMins = newEndMins;
      }
    }

    let travelerLanguage = 'English';
    let flag = '🇬🇧';
    let travelerMsg = `Dear Guests, please note your tour today has been adjusted by ${delayMinutes} minutes due to unexpected traffic. We are actively coordinating with your upcoming guides to ensure a seamless experience.`;

    if (new RegExp('german|ألمان|germany', 'i').test(travelerNationality)) {
      travelerLanguage = 'German';
      flag = '🇩🇪';
      travelerMsg = `Sehr geehrte Gäste, bitte beachten Sie, dass Ihr Tagesprogramm verkehrsbedingt um ${delayMinutes} Minuten verschoben wurde. Wir koordinieren alle weiteren Stationen für Sie.`;
    } else if (new RegExp('italian|إيطال|italy', 'i').test(travelerNationality)) {
      travelerLanguage = 'Italian';
      flag = '🇮🇹';
      travelerMsg = `Gentili ospiti, vi informiamo che il برنامج اليوم قد تأخر ${delayMinutes} دقيقة لظروف السير.`;
    } else if (new RegExp('french|فرنس', 'i').test(travelerNationality)) {
      travelerLanguage = 'French';
      flag = '🇫🇷';
      travelerMsg = `Chers invités, votre programme d'aujourd'hui a été décalé de ${delayMinutes} minutes en raison de la circulation.`;
    }

    return {
      delayMinutes,
      incidentType: 'delay',
      isCascadeImpact: isCascade,
      incidentSummary: `تأخير تشغيلي (${delayMinutes} دقيقة) في "${targetEvent.title}". تم تنفيذ حل وقائي ${isCascade ? 'وترحيل الفعاليات اللاحقة لتفادي أي تداخل' : 'بدون تأثير على باقي الفعاليات'}.`,
      scheduleAdjustments,
      downstreamNotices,
      travelerNotification: {
        language: travelerLanguage,
        flag,
        title: 'Schedule Update',
        message: travelerMsg,
        translatedSummaryInArabic: `إشعار الضيوف بلغتهم (${travelerLanguage}) بتأخير ${delayMinutes} دقيقة مع تأكيد سير باقي اليوم بانتظام.`,
      },
    };
  }
}
