import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendWhatsAppTextMessage } from './sender';
import type {
  OrchestrationDecision,
  OrchestrationExecutionResult,
  ScheduleAdjustment,
  DownstreamVendorNotice,
} from './types';

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * Autonomous AI Operations Orchestrator:
 * When an incoming message indicates a delay or schedule change, the LLM:
 * 1. Analyzes the delay amount and root cause.
 * 2. Examines the full itinerary timeline to check if subsequent trips are impacted.
 * 3. Calculates non-overlapping adjusted start and end times for all affected events.
 * 4. Drafts natural, human-like Arabic WhatsApp notices to notify downstream vendors.
 * 5. Updates Supabase with the new schedule and comprehensive incident log.
 * 6. Dispatches the WhatsApp messages directly to the affected downstream vendors.
 */
export async function orchestrateItineraryCascade(options: {
  eventId: string;
  vendorMessage: string;
  senderPhone?: string;
}): Promise<OrchestrationExecutionResult> {
  const supabase = createServerSupabaseClient();
  const { eventId, vendorMessage } = options;

  // 1. Fetch current target event
  const { data: targetEvent, error: targetErr } = await supabase
    .from('itinerary_events')
    .select('id, itinerary_id, event_date, start_time, end_time, title, status, sort_order, experience_provider_id')
    .eq('id', eventId)
    .single();

  if (targetErr || !targetEvent) {
    console.error(`[AI Orchestrator] ❌ Target event ${eventId} not found:`, targetErr);
    return {
      success: false,
      updatedEventsCount: 0,
      dispatchedNoticesCount: 0,
      error: `Event ${eventId} not found in database.`,
    };
  }

  // 2. Fetch all events in this itinerary for the same day (or whole itinerary)
  const { data: allEvents, error: allEventsErr } = await supabase
    .from('itinerary_events')
    .select('id, itinerary_id, event_date, start_time, end_time, title, status, sort_order, experience_provider_id, escalation_reason')
    .eq('itinerary_id', targetEvent.itinerary_id)
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (allEventsErr || !allEvents || allEvents.length === 0) {
    console.error('[AI Orchestrator] ❌ Failed to fetch itinerary events:', allEventsErr);
    return {
      success: false,
      updatedEventsCount: 0,
      dispatchedNoticesCount: 0,
      error: 'Failed to fetch itinerary events.',
    };
  }

  // 3. Fetch linked experience providers for phone numbers and names
  const { data: providers } = await supabase
    .from('experience_providers')
    .select('id, name, phone_number');

  // 4. Fetch itinerary & traveler profile info (nationality, group size)
  const { data: itineraryData } = await supabase
    .from('itineraries')
    .select('id, title, guest_count, traveler_profile_id')
    .eq('id', targetEvent.itinerary_id)
    .single();

  let travelerNationality = 'دولي';
  let groupSize = itineraryData?.guest_count || 2;

  if (itineraryData?.traveler_profile_id) {
    const { data: profileData } = await supabase
      .from('traveler_profiles')
      .select('nationality, group_size')
      .eq('id', itineraryData.traveler_profile_id)
      .single();

    if (profileData) {
      travelerNationality = profileData.nationality || travelerNationality;
      groupSize = profileData.group_size || groupSize;
    }
  }

  // 5. Build enriched schedule structure for the LLM
  const enrichedEvents = allEvents.map((ev, index) => {
    const prov = providers?.find((p) => p.id === ev.experience_provider_id);
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
    };
  });

  // 6. Consult Groq LLM as the Autonomous Operations Director
  const apiKey = process.env.GROQ_API_KEY;
  const model = process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b';

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
    } catch (llmErr) {
      console.warn('[AI Orchestrator] ⚠️ Groq LLM call failed, falling back to rule-based orchestration:', llmErr);
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

  console.log('[AI Orchestrator] 🧠 Autonomous Decision Orchestrated by LLM:', {
    delayMinutes: decision.delayMinutes,
    isCascadeImpact: decision.isCascadeImpact,
    adjustmentsCount: decision.scheduleAdjustments.length,
    downstreamNoticesCount: decision.downstreamNotices.length,
    incidentSummary: decision.incidentSummary,
  });

  // 7. Execute Schedule Adjustments in Database
  let updatedEventsCount = 0;
  for (const adj of decision.scheduleAdjustments) {
    const startStr = adj.newStartTime.length === 5 ? `${adj.newStartTime}:00` : adj.newStartTime;
    const endStr = adj.newEndTime.length === 5 ? `${adj.newEndTime}:00` : adj.newEndTime;

    const { error: updateErr } = await supabase
      .from('itinerary_events')
      .update({
        start_time: startStr,
        end_time: endStr,
        status: adj.newStatus || 'escalated',
        escalation_reason: adj.reason || decision.incidentSummary,
        updated_at: new Date().toISOString(),
      })
      .eq('id', adj.eventId);

    if (!updateErr) {
      updatedEventsCount++;
      console.log(
        `[AI Orchestrator] 🕒 Updated event "${adj.eventTitle}" time to ${adj.newStartTime} - ${adj.newEndTime} (Status: ${adj.newStatus || 'escalated'})`
      );
    } else {
      console.error(`[AI Orchestrator] ❌ Failed to update event ${adj.eventId}:`, updateErr);
    }
  }

  // 8. Dispatch Proactive WhatsApp Messages to Impacted Downstream Vendors
  let dispatchedNoticesCount = 0;
  for (const notice of decision.downstreamNotices) {
    if (notice.whatsappMessage && notice.whatsappMessage.trim().length > 0) {
      console.log(
        `[AI Orchestrator] 📱 Dispatching cascade notice to downstream vendor "${notice.providerName}" (${notice.providerPhone || 'fallback'})...`
      );

      const sendRes = await sendWhatsAppTextMessage(
        notice.providerPhone || '',
        notice.whatsappMessage
      );

      if (sendRes.success) {
        dispatchedNoticesCount++;
        console.log(`[AI Orchestrator] ✅ Cascade notice sent to "${notice.providerName}"!`);
      } else {
        console.warn(`[AI Orchestrator] ⚠️ Failed to send notice to "${notice.providerName}":`, sendRes.error);
      }
    }
  }

  return {
    success: true,
    decision,
    updatedEventsCount,
    dispatchedNoticesCount,
    incidentSummary: decision.incidentSummary,
  };
}

/**
 * Prompts Groq LLM to act as the Senior Autonomous Operations Dispatcher.
 */
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
  const { targetEventId, vendorMessage, enrichedEvents, travelerNationality, groupSize, apiKey, model } = params;

  const targetEvent = enrichedEvents.find((e) => e.eventId === targetEventId);

  const scheduleDescription = enrichedEvents
    .map((e) => {
      const marker = e.isTargetEvent ? '⭐ [الفعالية المتأثرة بالبلاغ]' : `[الفعالية رقم ${e.order}]`;
      return `${marker}:
- معرف الفعالية: "${e.eventId}"
- اسم الفعالية: "${e.title}"
- المزود: "${e.providerName}" (هاتف: ${e.providerPhone || 'غير مسجل'})
- الموعد الأصلي: من الساعة ${e.startTime} إلى ${e.endTime} (التاريخ: ${e.date})
- الحالة الحالية: ${e.status}`;
    })
    .join('\n\n');

  const systemPrompt = `You are the Senior AI Operations Director & Dispatch Orchestrator for a premier Saudi Destination Management Company (DMC).
You operate with 90% autonomous operational intelligence to manage trip schedules, resolve vendor delays, eliminate schedule conflicts, and coordinate downstream vendors.

You receive an operational WhatsApp message (text or voice transcription) from a provider regarding an activity in an active itinerary.
Guest Details: الوفد (${travelerNationality}) عددهم ${groupSize} أشخاص.

YOUR AUTONOMOUS MISSION:
1. UNDERSTAND DELAY & ROOT CAUSE:
   - Extract the delay duration (e.g. 2 hours, 90 minutes, 30 minutes, or a new stated start time like 16:00).
   - If not explicitly stated in hours/minutes, deduce the realistic delay from the vendor's context.

2. CASCADE IMPACT ANALYSIS ON SUBSEQUENT TRIPS (CRITICAL):
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
     * Tone: Professional, warm Saudi hospitality style ("السلام عليكم ورحمة الله، حياك الله أخوي [اسم المزود] 👋 معك منسق العمليات في There DMC").
     * Inform them naturally that the group experienced an unexpected delay in their previous tour/activity.
     * State the updated estimated arrival time clearly ("نقّدر وصول الوفد لكم الساعة [الوقت الجديد] بدلاً من [الوقت الأصلي]").
     * Respect traveler privacy: mention group nationality and size, NEVER traveler personal names.
     * Ask politely if this updated time is suitable for them to host the delegation ("الله يسعدك هل هذا الموعد يناسبكم لاستقبالهم؟").
     * NO bot buttons or robotic templates. Pure human-like conversational Arabic.

4. WRITE SYSTEM INCIDENT SUMMARY ("incidentSummary"):
   - A clear, authoritative Arabic operational log note summarizing the root cause, delay amount, schedule changes made, and downstream vendors alerted.

Respond ONLY with valid JSON in this exact structure:
{
  "delayMinutes": 120,
  "incidentType": "delay" | "emergency" | "reschedule" | "cancellation" | "general",
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
  ]
}`;

  const userPrompt = `رسالة المزود الواردة (النصية أو الصوتية):
"${vendorMessage}"

الفعالية المعنية: "${targetEvent?.title || 'الفعالية'}" (الموعد: ${targetEvent?.startTime} - ${targetEvent?.endTime})
جدول الرحلة الكامل لهذا اليوم:
${scheduleDescription}`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Groq LLM orchestrator failed [HTTP ${response.status}]: ${errText}`);
  }

  const data = (await response.json()) as GroqChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Groq LLM returned empty content for orchestration.');
  }

  const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
  const parsed = JSON.parse(cleaned) as OrchestrationDecision;

  return {
    delayMinutes: typeof parsed.delayMinutes === 'number' ? parsed.delayMinutes : 60,
    incidentType: parsed.incidentType || 'delay',
    isCascadeImpact: Boolean(parsed.isCascadeImpact),
    incidentSummary: parsed.incidentSummary || 'تم ترحيل الجدول تلقائياً بالذكاء الاصطناعي لتفادي التضارب.',
    scheduleAdjustments: Array.isArray(parsed.scheduleAdjustments) ? parsed.scheduleAdjustments : [],
    downstreamNotices: Array.isArray(parsed.downstreamNotices) ? parsed.downstreamNotices : [],
  };
}

/**
 * Deterministic fallback orchestration if Groq LLM is unreachable.
 * Calculates time math (e.g. 2 hours / 120 mins delay), cascades downstream events,
 * and drafts standard polite Arabic messages.
 */
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

  // Check downstream events
  for (let i = targetIdx + 1; i < allEvents.length; i++) {
    const nextEv = allEvents[i];
    const [prevH, prevM] = prevEndTime.split(':').map((v) => parseInt(v, 10));
    const prevTotal = prevH * 60 + prevM + 30; // 30 min transit buffer

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
        whatsappMessage: `السلام عليكم ورحمة الله، حياك الله أخوي ${nextEv.providerName} 👋\n\nمعك منسق العمليات في There DMC.\nحابين نبلغكم بخصوص حجز وفد (${travelerNationality}) عددهم ${groupSize} أشخاص اليوم، صار في تأخير خارج عن الإرادة في الجولة السابقة، وبناءً عليه نقدر وصول الوفد لكم الساعة ${adjustedStart} بدلاً من ${nextEv.startTime}.\n\nالله يسعدك ودنا نتأكد هل هذا التوقيت مناسب وجاهزيتكم لاستقبالهم؟\nشاكرين ومقدرين تعاونكم الدائم 🙏`,
      });

      prevEndTime = adjustedEnd;
    }
  }

  const incidentSummary = `رصد تأخير قدره ${delayMinutes} دقيقة في تجربة "${currentTarget.title}". قام النظام الذكي بترحيل المواعيد اللاحقة وإشعار ${downstreamNotices.length} مزودين تالين عبر الواتساب لتفادي أي تضارب.`;

  return {
    delayMinutes,
    incidentType: 'delay',
    isCascadeImpact,
    incidentSummary,
    scheduleAdjustments,
    downstreamNotices,
  };
}
