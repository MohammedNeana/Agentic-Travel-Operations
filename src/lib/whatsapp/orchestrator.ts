import { createServerSupabaseClient } from '@/lib/supabase/server';
import {
  OrchestrationDecision,
  OrchestrationExecutionResult,
  ScheduleAdjustment,
  DownstreamVendorNotice,
  OutboxNoticeRecord,
} from './types';
import { stageOutboxNotices, dispatchPendingOutboxNotices } from './outbox';
import { callLLMJson } from '@/lib/ai/llm-client';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';
import { recordAgentOperation } from '@/lib/agent/audit-log';
import crypto from 'crypto';

export async function orchestrateItineraryCascade(options: {
  eventId: string;
  vendorMessage: string;
  senderPhone?: string;
  triggerMessageId?: string;
  tenantId?: string;
}): Promise<OrchestrationExecutionResult> {
  const supabase = createServerSupabaseClient();
  const { eventId, vendorMessage } = options;
  const startTs = Date.now();

  let targetQuery = supabase
    .from('itinerary_events')
    .select('id, itinerary_id, tenant_id, event_date, start_time, end_time, title, status, sort_order, experience_provider_id')
    .eq('id', eventId);

  if (options.tenantId) {
    targetQuery = targetQuery.eq('tenant_id', options.tenantId);
  }

  const { data: targetEvent, error: targetErr } = await targetQuery.single();

  if (targetErr || !targetEvent) {
    return {
      success: false,
      updatedEventsCount: 0,
      dispatchedNoticesCount: 0,
      error: `Event ${eventId} not found in database.`,
    };
  }

  const tenantId = options.tenantId || targetEvent.tenant_id;

  let allEventsQuery = supabase
    .from('itinerary_events')
    .select('id, itinerary_id, event_date, start_time, end_time, title, status, sort_order, experience_provider_id, escalation_reason')
    .eq('itinerary_id', targetEvent.itinerary_id)
    .eq('event_date', targetEvent.event_date)
    .order('start_time', { ascending: true });

  if (tenantId) {
    allEventsQuery = allEventsQuery.eq('tenant_id', tenantId);
  }

  const { data: allEvents, error: allEventsErr } = await allEventsQuery;

  if (allEventsErr || !allEvents || allEvents.length === 0) {
    return {
      success: false,
      updatedEventsCount: 0,
      dispatchedNoticesCount: 0,
      error: 'Failed to fetch itinerary events.',
    };
  }

  let providersQuery = supabase
    .from('experience_providers')
    .select('id, name, phone_number');

  if (tenantId) {
    providersQuery = providersQuery.eq('tenant_id', tenantId);
  }

  const { data: providers } = await providersQuery;

  let itinQuery = supabase
    .from('itineraries')
    .select('id, title, guest_count, traveler_profile_id')
    .eq('id', targetEvent.itinerary_id);

  if (tenantId) {
    itinQuery = itinQuery.eq('tenant_id', tenantId);
  }

  const { data: itineraryData } = await itinQuery.single();

  let travelerNationality = 'دولي';
  let groupSize = itineraryData?.guest_count || 2;

  if (itineraryData?.traveler_profile_id) {
    let profileQuery = supabase
      .from('traveler_profiles')
      .select('nationality, group_size')
      .eq('id', itineraryData.traveler_profile_id);

    if (tenantId) {
      profileQuery = profileQuery.eq('tenant_id', tenantId);
    }

    const { data: profileData } = await profileQuery.single();

    if (profileData) {
      travelerNationality = profileData.nationality || travelerNationality;
      groupSize = profileData.group_size || groupSize;
    }
  }

  const enrichedEvents = allEvents.map((ev, index) => {
    const prov = providers?.find((p) => p.id === ev.experience_provider_id);
    const isImmutable =
      Boolean((ev as Record<string, unknown>).is_immutable) ||
      /flight|طيران|مطار|airport|border|منفذ|قطار|train/i.test(ev.title);
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

  if (apiKey) {
    try {
      decision = await consultLLMOrchestrator({
        targetEventId: targetEvent.id,
        vendorMessage,
        enrichedEvents,
        travelerNationality,
        groupSize,
        apiKey,
        model,
      });
    } catch {
      decision = fallbackOrchestrationDecision({
        targetEvent,
        allEvents: enrichedEvents,
        vendorMessage,
        travelerNationality,
        groupSize,
      });
    }
  } else {
    decision = fallbackOrchestrationDecision({
      targetEvent,
      allEvents: enrichedEvents,
      vendorMessage,
      travelerNationality,
      groupSize,
    });
  }

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

  if (!validation.isValid || !validation.validatedDecision) {
    const escalationReason = `AI Action Boundary Block: Schedule adjustments rejected due to domain constraint violations: ${validation.violations.join('; ')}`;
    await supabase
      .from('itinerary_events')
      .update({
        status: 'escalated',
        escalation_reason: escalationReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetEvent.id);

    await recordAgentOperation({
      operationId: crypto.randomUUID(),
      operationType: 'action_boundary_block',
      tenantId: options.tenantId || targetEvent.tenant_id,
      itineraryId: targetEvent.itinerary_id,
      eventId: targetEvent.id,
      triggerMessageId: options.triggerMessageId,
      senderPhone: options.senderPhone,
      llmModel: model,
      latencyMs: Date.now() - startTs,
      rationale: vendorMessage,
      validationStatus: 'rejected',
      violations: validation.violations,
    });

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

  const targetIds = validatedDecision.scheduleAdjustments.map((a) => a.eventId);
  let snapshotQuery = supabase
    .from('itinerary_events')
    .select('id, start_time, end_time, status, escalation_reason, updated_at')
    .in('id', targetIds);

  if (tenantId) {
    snapshotQuery = snapshotQuery.eq('tenant_id', tenantId);
  }

  const { data: snapshotRows } = await snapshotQuery;

  const successfullyUpdatedIds: string[] = [];
  let updateFailed = false;
  let updateErrorMessage = '';

  for (const adj of validatedDecision.scheduleAdjustments) {
    const startStr = adj.newStartTime.length === 5 ? `${adj.newStartTime}:00` : adj.newStartTime;
    const endStr = adj.newEndTime.length === 5 ? `${adj.newEndTime}:00` : adj.newEndTime;

    const baseReason = adj.reason || validatedDecision.incidentSummary;
    const fullReason = validatedDecision.travelerNotification
      ? `${baseReason} [${validatedDecision.travelerNotification.language}]: "${validatedDecision.travelerNotification.message}"`
      : baseReason;

    let updateQuery = supabase
      .from('itinerary_events')
      .update({
        start_time: startStr,
        end_time: endStr,
        status: adj.newStatus || 'escalated',
        escalation_reason: fullReason,
        updated_at: new Date().toISOString(),
      })
      .eq('id', adj.eventId);

    if (tenantId) {
      updateQuery = updateQuery.eq('tenant_id', tenantId);
    }

    const { error: updateErr } = await updateQuery;

    if (updateErr) {
      updateFailed = true;
      updateErrorMessage = updateErr.message;
      break;
    }
    successfullyUpdatedIds.push(adj.eventId);
  }

  if (updateFailed) {
    if (snapshotRows && snapshotRows.length > 0 && successfullyUpdatedIds.length > 0) {
      const rowsToRollback = snapshotRows.filter((r) => successfullyUpdatedIds.includes(r.id));
      for (const orig of rowsToRollback) {
        let rollbackQuery = supabase
          .from('itinerary_events')
          .update({
            start_time: orig.start_time,
            end_time: orig.end_time,
            status: orig.status,
            escalation_reason: orig.escalation_reason,
            updated_at: orig.updated_at,
          })
          .eq('id', orig.id);

        if (tenantId) {
          rollbackQuery = rollbackQuery.eq('tenant_id', tenantId);
        }

        await rollbackQuery;
      }
    }

    await recordAgentOperation({
      operationId: crypto.randomUUID(),
      operationType: 'transaction_rollback',
      tenantId: options.tenantId || targetEvent.tenant_id,
      itineraryId: targetEvent.itinerary_id,
      eventId: targetEvent.id,
      triggerMessageId: options.triggerMessageId,
      senderPhone: options.senderPhone,
      llmModel: model,
      latencyMs: Date.now() - startTs,
      rationale: `Atomic transaction rollback: ${updateErrorMessage}`,
      validationStatus: 'rejected',
      violations: [`Database Update Failure: ${updateErrorMessage}`],
    });

    return {
      success: false,
      updatedEventsCount: 0,
      dispatchedNoticesCount: 0,
      error: `Transaction rolled back due to update error: ${updateErrorMessage}`,
      incidentSummary: validatedDecision.incidentSummary,
      rollbackOccurred: true,
    };
  }

  const rawNotices = validatedDecision.downstreamNotices
    .filter((n) => n.whatsappMessage && n.whatsappMessage.trim().length > 0)
    .map((notice) => ({
      eventId: notice.eventId,
      providerName: notice.providerName,
      providerPhone: notice.providerPhone || '',
      message: notice.whatsappMessage,
    }));

  const stagedNotices = await stageOutboxNotices(supabase, rawNotices, tenantId);
  const { dispatchedCount: dispatchedNoticesCount, updatedNotices: outboxNotices } =
    await dispatchPendingOutboxNotices(supabase, stagedNotices);

  await recordAgentOperation({
    operationId: crypto.randomUUID(),
    operationType: 'schedule_cascade',
    tenantId: options.tenantId || targetEvent.tenant_id,
    itineraryId: targetEvent.itinerary_id,
    eventId: targetEvent.id,
    triggerMessageId: options.triggerMessageId,
    senderPhone: options.senderPhone,
    llmModel: model,
    latencyMs: Date.now() - startTs,
    rationale: validatedDecision.incidentSummary,
    validationStatus: 'passed',
    metadata: {
      delayMinutes: validatedDecision.delayMinutes,
      updatedEventsCount: successfullyUpdatedIds.length,
      dispatchedNoticesCount,
      totalOutboxNotices: outboxNotices.length,
      outboxNotices,
      incidentType: validatedDecision.incidentType,
    },
  });

  return {
    success: true,
    decision: validatedDecision,
    updatedEventsCount: successfullyUpdatedIds.length,
    dispatchedNoticesCount,
    incidentSummary: validatedDecision.incidentSummary,
    travelerNotification: validatedDecision.travelerNotification,
    outboxNotices,
  };
}

async function consultLLMOrchestrator(params: {
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
  apiKey: string;
  model: string;
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

  const systemPrompt = `You are the Senior AI Operations Director & Dispatch Orchestrator for a premier Saudi Destination Management Company (DMC).
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
      - Ask politely if this updated time is suitable for them to host the delegation ("الله يسعدك هل هذا الموعد يناسبكم لاستقبالهم؟").
      - NO bot buttons or robotic templates. Pure human-like conversational Arabic.

4. WRITE SYSTEM INCIDENT SUMMARY ("incidentSummary"):
   - A clear, authoritative Arabic operational log note summarizing the root cause, delay amount, schedule changes made, and downstream vendors alerted.

5. MULTILINGUAL TRAVELER / TOUR LEADER NOTIFICATION ("travelerNotification"):
   - When a delay or reschedule cascade occurs, the delegation tour leader / traveler must be notified in their NATIVE LANGUAGE based on delegation nationality: "${travelerNationality}".
   - Detect appropriate language:
     - If Japanese / ياباني -> Japanese (日本語)
     - If Italian / إيطالي -> Italian (Italiano)
     - If French / فرنسي -> French (Français)
     - If German / ألماني -> German (Deutsch)
     - If Arabic / عربي -> Arabic
     - Otherwise -> English
   - Draft a reassuring, professional update message in that language explaining the slight schedule adjustment, estimated new time, and ensuring them that their comfort and experience quality remain the top priority.
   - Include "translatedSummaryInArabic" so the DMC operations team can immediately understand the message.

Respond ONLY with valid JSON in this exact structure:
{
  "delayMinutes": 120,
  "incidentType": "delay",
  "isCascadeImpact": true,
  "incidentSummary": "Arabic summary of what happened, time shifted, and actions taken",
  "scheduleAdjustments": [
    {
      "eventId": "event-id-string",
      "eventTitle": "Title",
      "previousStartTime": "14:00",
      "previousEndTime": "17:00",
      "newStartTime": "16:00",
      "newEndTime": "19:00",
      "newStatus": "escalated",
      "reason": "تأخير ساعتين في بدء الجولة وإشعار المزود"
    }
  ],
  "downstreamNotices": [
    {
      "eventId": "next-event-id-string",
      "providerName": "اسم المزود التالي",
      "providerPhone": "05xxxxxxxx",
      "newStartTime": "19:30",
      "whatsappMessage": "نص رسالة الواتساب البشرية الدافئة للمزود التالي..."
    }
  ],
  "travelerNotification": {
    "language": "Japanese (日本語)",
    "flag": "JP",
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

  const result = await callLLMJson<OrchestrationDecision>({
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

function fallbackOrchestrationDecision(params: {
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
  const normMsg = vendorMessage.toLowerCase();
  if (normMsg.includes('ساعتين') || normMsg.includes('2 ساعة') || normMsg.includes('ساعتان') || normMsg.includes('2 hours')) {
    delayMinutes = 120;
  } else if (normMsg.includes('ثلاث ساعات') || normMsg.includes('3 ساعات')) {
    delayMinutes = 180;
  } else if (normMsg.includes('نصف ساعة') || normMsg.includes('نص ساعة') || normMsg.includes('30 دقيقة')) {
    delayMinutes = 30;
  }

  const addMinutesToTime = (timeStr: string, mins: number): string => {
    const [h, m] = timeStr.split(':').map((v) => parseInt(v, 10));
    const totalMins = (h || 0) * 60 + (m || 0) + mins;
    const newH = Math.floor(totalMins / 60) % 24;
    const newM = totalMins % 60;
    return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
  };

  const scheduleAdjustments: ScheduleAdjustment[] = [];
  const downstreamNotices: DownstreamVendorNotice[] = [];

  const targetIdx = allEvents.findIndex((e) => e.eventId === targetEvent.id);
  const currentTarget = allEvents[targetIdx] || allEvents[0];

  const newTargetStart = addMinutesToTime(currentTarget.startTime, delayMinutes);
  const newTargetEnd = addMinutesToTime(currentTarget.endTime, delayMinutes);

  scheduleAdjustments.push({
    eventId: currentTarget.eventId,
    eventTitle: currentTarget.title,
    previousStartTime: currentTarget.startTime,
    previousEndTime: currentTarget.endTime,
    newStartTime: newTargetStart,
    newEndTime: newTargetEnd,
    newStatus: 'escalated',
    reason: `تأخير يقدر بـ ${delayMinutes} دقيقة بناءً على إفادة المزود: "${vendorMessage}"`,
  });

  let prevEndTime = newTargetEnd;
  let isCascadeImpact = false;

  for (let i = targetIdx + 1; i < allEvents.length; i++) {
    const nextEv = allEvents[i];
    if (nextEv.date && currentTarget.date && nextEv.date !== currentTarget.date) {
      continue;
    }
    const [prevH, prevM] = prevEndTime.split(':').map((v) => parseInt(v, 10));
    const prevTotal = prevH * 60 + prevM + 30;

    const [nextH, nextM] = nextEv.startTime.split(':').map((v) => parseInt(v, 10));
    const nextTotal = nextH * 60 + nextM;

    if (prevTotal > nextTotal) {
      isCascadeImpact = true;
      const shiftMins = prevTotal - nextTotal;
      const adjustedStart = addMinutesToTime(nextEv.startTime, shiftMins);
      const adjustedEnd = addMinutesToTime(nextEv.endTime, shiftMins);

      scheduleAdjustments.push({
        eventId: nextEv.eventId,
        eventTitle: nextEv.title,
        previousStartTime: nextEv.startTime,
        previousEndTime: nextEv.endTime,
        newStartTime: adjustedStart,
        newEndTime: adjustedEnd,
        newStatus: 'escalated',
        reason: `ترحيل تلقائي للموعد (${adjustedStart}) لتفادي التضارب مع الفعالية السابقة المتأخرة.`,
      });

      downstreamNotices.push({
        eventId: nextEv.eventId,
        providerName: nextEv.providerName,
        providerPhone: nextEv.providerPhone,
        newStartTime: adjustedStart,
        whatsappMessage: `السلام عليكم ورحمة الله، حياك الله أخوي ${nextEv.providerName}\n\nمعك منسق العمليات في There DMC.\nحابين نبلغكم بخصوص حجز وفد (${travelerNationality}) عددهم ${groupSize} أشخاص اليوم، صار في تأخير خارج عن الإرادة في الجولة السابقة، وبناءً عليه نقدر وصول الوفد لكم الساعة ${adjustedStart} بدلاً من ${nextEv.startTime}.\n\nالله يسعدك ودنا نتأكد هل هذا التوقيت مناسب وجاهزيتكم لاستقبالهم؟\nشاكرين ومقدرين تعاونكم الدائم`,
      });

      prevEndTime = adjustedEnd;
    }
  }

  const incidentSummary = `رصد تأخير قدره ${delayMinutes} دقيقة في تجربة "${currentTarget.title}". قام النظام الذكي بترحيل المواعيد اللاحقة وإشعار ${downstreamNotices.length} مزودين تالين عبر الواتساب لتفادي أي تضارب.`;

  const isJapanese = travelerNationality.includes('يابان') || travelerNationality.toLowerCase().includes('japan');
  const isItalian = travelerNationality.includes('إيطال') || travelerNationality.toLowerCase().includes('ital');

  const travelerNotification = isJapanese
    ? {
        language: 'Japanese (日本語)',
        flag: 'JP',
        title: 'ツアースケジュール更新のお知らせ',
        message: `お客様各位、前後の観光行程の都合により、本日のツアー開始時刻が ${newTargetStart} に変更となりました。ご不便をおかけしますが、最高の体験をお届けできるよう準備しております。何卒よろしくお願い申し上げます。`,
        translatedSummaryInArabic: `إشعار باليابانية: تم إبلاغ الوفد بترحيل موعد الجولة إلى ${newTargetStart} مع التأكيد على سلامتهم وراحتهم.`,
      }
    : isItalian
    ? {
        language: 'Italian (Italiano)',
        flag: 'IT',
        title: 'Aggiornamento Orario Itinerario',
        message: `Gentili ospiti, a causa di un lieve ritardo nell'attività precedente, il nuovo orario di inizio è previsto per le ${newTargetStart}. Ci scusiamo per l'inconveniente e vi ringraziamo per la comprensione.`,
        translatedSummaryInArabic: `إشعار بالإيطالية: تم إبلاغ الوفد بترحيل موعد الجولة إلى ${newTargetStart} مع الاعتذار والشكر لتفهمهم.`,
      }
    : {
        language: 'English',
        flag: 'EN',
        title: 'Schedule Update Notification',
        message: `Dear Guests, due to a minor delay in the previous experience, your upcoming activity will now commence at ${newTargetStart}. We appreciate your patience and look forward to delivering a wonderful experience.`,
        translatedSummaryInArabic: `إشعار بالإنجليزية: تم إبلاغ الوفد بترحيل الموعد إلى ${newTargetStart}.`,
      };

  return {
    delayMinutes,
    incidentType: 'delay',
    isCascadeImpact,
    incidentSummary,
    scheduleAdjustments,
    downstreamNotices,
    travelerNotification,
  };
}
