import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { CandidateGroupEvent } from './types';

export interface EventUpdateResult {
  success: boolean;
  eventId?: string;
  previousStatus?: string;
  newStatus?: string;
  title?: string;
  error?: string;
}

/**
 * Updates a specific itinerary event status to 'confirmed'.
 * Triggered by WhatsApp interactive button reply: accept_booking_{id}.
 */
export async function confirmItineraryEvent(eventId: string): Promise<EventUpdateResult> {
  const supabase = createServerSupabaseClient();

  // 1. Verify existence of the event
  const { data: event, error: fetchError } = await supabase
    .from('itinerary_events')
    .select('id, title, status')
    .eq('id', eventId)
    .single();

  if (fetchError || !event) {
    console.error(`Failed to find itinerary event with id ${eventId}:`, fetchError);
    return {
      success: false,
      eventId,
      error: `Event ${eventId} not found in database.`,
    };
  }

  // 2. Perform status transition to 'confirmed'
  const { error: updateError } = await supabase
    .from('itinerary_events')
    .update({
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);

  if (updateError) {
    console.error(`Failed to update event ${eventId} to confirmed:`, updateError);
    return {
      success: false,
      eventId,
      previousStatus: event.status,
      error: updateError.message,
    };
  }

  return {
    success: true,
    eventId: event.id,
    previousStatus: event.status,
    newStatus: 'confirmed',
    title: event.title,
  };
}

/**
 * Updates a specific itinerary event status to 'cancelled'.
 * Triggered by WhatsApp button reply (reject_booking_{id}) or LLM intent classification (Rejection).
 */
export async function rejectItineraryEvent(
  eventId: string,
  reason = 'اعتذار المزود عن قبول الحجز'
): Promise<EventUpdateResult> {
  const supabase = createServerSupabaseClient();

  const { data: event, error: fetchError } = await supabase
    .from('itinerary_events')
    .select('id, title, status')
    .eq('id', eventId)
    .single();

  if (fetchError || !event) {
    console.error(`Failed to find itinerary event with id ${eventId}:`, fetchError);
    return {
      success: false,
      eventId,
      error: `Event ${eventId} not found in database.`,
    };
  }

  const { error: updateError } = await supabase
    .from('itinerary_events')
    .update({
      status: 'cancelled',
      escalation_reason: reason,
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);

  if (updateError) {
    console.error(`Failed to update event ${eventId} to cancelled:`, updateError);
    return {
      success: false,
      eventId,
      previousStatus: event.status,
      error: updateError.message,
    };
  }

  console.log(`\x1b[33m[WhatsApp Rejection]\x1b[0m Event "${event.title}" marked as cancelled/rejected.`);

  return {
    success: true,
    eventId: event.id,
    previousStatus: event.status,
    newStatus: 'cancelled',
    title: event.title,
  };
}

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '') // remove diacritics / tashkeel
    .replace(/[إأآٱ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي')
    .replace(/[^\w\s\u0600-\u06FF]/g, ' ')
    .toLowerCase()
    .trim();
}

const ARABIC_STOP_WORDS = new Set([
  'في', 'من', 'على', 'إلى', 'عن', 'مع', 'هذا', 'هذه', 'تم', 'كان', 'يوم', 'رحلة', 'جولة'
]);

/**
 * Updates an itinerary event status to 'escalated'.
 * Triggered when a voice note is classified as 'Emergency' or 'Delay'.
 * Uses intelligent Arabic keyword matching against event titles when transcriptionText is provided.
 */
export async function escalateItineraryEvent(options?: {
  eventId?: string;
  transcriptionText?: string;
  reason?: string;
  senderPhone?: string;
}): Promise<EventUpdateResult> {
  const supabase = createServerSupabaseClient();
  let targetEventId = options?.eventId;

  // If no explicit eventId is provided, find the best matching event
  if (!targetEventId) {
    const { data: allActiveEvents, error: lookupError } = await supabase
      .from('itinerary_events')
      .select('id, title, description, status, event_date, start_time')
      .neq('status', 'cancelled')
      .order('event_date', { ascending: true })
      .order('sort_order', { ascending: true });

    if (lookupError || !allActiveEvents || allActiveEvents.length === 0) {
      console.warn('No active events found to escalate:', lookupError);
      return {
        success: false,
        error: 'No active itinerary events found for escalation.',
      };
    }

    // If transcriptionText is available, match keywords against event titles
    if (options?.transcriptionText && options.transcriptionText.trim().length > 0) {
      const normTrans = normalizeArabic(options.transcriptionText);
      const transWords = normTrans.split(/\s+/).filter(w => w.length >= 2 && !ARABIC_STOP_WORDS.has(w));

      console.log(`[Escalation Matcher] 🔍 Matching transcription "${options.transcriptionText}" against ${allActiveEvents.length} events...`);

      let bestScore = 0;
      let bestEvent = allActiveEvents[0];

      for (const ev of allActiveEvents) {
        const normTitle = normalizeArabic(ev.title);
        const titleWords = normTitle.split(/\s+/).filter(w => w.length >= 2 && !ARABIC_STOP_WORDS.has(w));

        let score = 0;
        for (const tw of titleWords) {
          if (normTrans.includes(tw)) score += 3;
        }
        for (const tw of transWords) {
          if (normTitle.includes(tw)) score += 2;
        }

        if (score > bestScore) {
          bestScore = score;
          bestEvent = ev;
        }
      }

      if (bestScore > 0) {
        console.log(`[Escalation Matcher] 🎯 High confidence match found: "${bestEvent.title}" (Score: ${bestScore})`);
        targetEventId = bestEvent.id;
      } else {
        console.log(`[Escalation Matcher] ⚠️ No keyword match found. Defaulting to upcoming event: "${allActiveEvents[0].title}"`);
        targetEventId = allActiveEvents[0].id;
      }
    } else {
      targetEventId = allActiveEvents[0].id;
    }
  }

  // Fetch current event state
  const { data: currentEvent, error: fetchErr } = await supabase
    .from('itinerary_events')
    .select('id, title, status')
    .eq('id', targetEventId)
    .single();

  if (fetchErr || !currentEvent) {
    return {
      success: false,
      eventId: targetEventId,
      error: `Event ${targetEventId} not found.`,
    };
  }

  // Update status to 'escalated' and store the voice transcription / reason
  const reasonText = options?.transcriptionText || options?.reason || 'بلاغ صوتي عاجل عبر واتساب';
  const { error: updateErr } = await supabase
    .from('itinerary_events')
    .update({
      status: 'escalated',
      escalation_reason: reasonText,
      updated_at: new Date().toISOString(),
    })
    .eq('id', targetEventId);

  if (updateErr) {
    console.error(`Failed to escalate event ${targetEventId}:`, updateErr);
    return {
      success: false,
      eventId: targetEventId,
      previousStatus: currentEvent.status,
      error: updateErr.message,
    };
  }

  console.log(`\x1b[31m[WhatsApp Escalation]\x1b[0m 🚨 Event "${currentEvent.title}" successfully escalated!`);

  return {
    success: true,
    eventId: targetEventId,
    previousStatus: currentEvent.status,
    newStatus: 'escalated',
    title: currentEvent.title,
  };
}

/**
 * Resolves Riyadh / Saudi local time for context calculations
 */
export function getRiyadhDateNow(): { dateStr: string; timeStr: string; currentHour: number } {
  const now = new Date();
  const riyadhOptions: Intl.DateTimeFormatOptions = {
    timeZone: 'Asia/Riyadh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  };
  const parts = new Intl.DateTimeFormat('en-CA', riyadhOptions).formatToParts(now);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || '';
  const dateStr = `${getPart('year')}-${getPart('month')}-${getPart('day')}`;
  const timeStr = `${getPart('hour')}:${getPart('minute')}`;
  const currentHour = parseInt(getPart('hour'), 10) || now.getHours();

  return { dateStr, timeStr, currentHour };
}

/**
 * Computes time relative context for an event (e.g. running now, upcoming after a while, past today).
 */
export function computeTimeContext(
  eventDate: string,
  startTime: string,
  endTime: string,
  currentDateStr: string,
  currentTimeStr: string
): {
  timeContext: 'running_now' | 'upcoming_today' | 'past_today' | 'future_date' | 'past_date';
  timeContextDescription: string;
  timePeriod: string;
} {
  const [startH] = startTime.split(':').map((v) => parseInt(v, 10));
  let timePeriod = 'صباحاً (Morning)';
  if (startH >= 12 && startH < 17) {
    timePeriod = 'عصراً/ظهراً (Afternoon)';
  } else if (startH >= 17) {
    timePeriod = 'مساءً (Evening)';
  }

  if (eventDate === currentDateStr) {
    if (currentTimeStr >= startTime && currentTimeStr <= endTime) {
      return {
        timeContext: 'running_now',
        timeContextDescription: 'جاري حالياً (Running now)',
        timePeriod,
      };
    }
    if (currentTimeStr < startTime) {
      return {
        timeContext: 'upcoming_today',
        timeContextDescription: 'قادم اليوم بعد قليل (Upcoming today / After a while)',
        timePeriod,
      };
    }
    return {
      timeContext: 'past_today',
      timeContextDescription: 'انتهى اليوم سابقاً (Past today / Concluded)',
      timePeriod,
    };
  }

  if (eventDate > currentDateStr) {
    return {
      timeContext: 'future_date',
      timeContextDescription: `موعد مستقبلي (${eventDate})`,
      timePeriod,
    };
  }

  return {
    timeContext: 'past_date',
    timeContextDescription: `تاريخ سابق (${eventDate})`,
    timePeriod,
  };
}

/**
 * Retrieves all candidate active events/groups for a provider,
 * enriched with group demographic details (nationality, group size, dietary, mobility)
 * and time-relative status (running now, upcoming after a while, or past).
 */
export async function getProviderCandidateEvents(options: {
  senderPhone?: string;
  providerId?: string;
}): Promise<CandidateGroupEvent[]> {
  const supabase = createServerSupabaseClient();
  let targetProviderId = options.providerId;

  // 1. Identify provider from senderPhone if providerId wasn't passed
  if (!targetProviderId && options.senderPhone) {
    const cleaned = options.senderPhone.replace(/[^\d]/g, '');
    const lastDigits = cleaned.slice(-8);

    const { data: providers } = await supabase
      .from('experience_providers')
      .select('id, name, phone_number');

    const matching = providers?.find((p) => {
      const pCleaned = (p.phone_number || '').replace(/[^\d]/g, '');
      return (
        pCleaned.endsWith(lastDigits) ||
        (lastDigits.length >= 7 && cleaned.endsWith(pCleaned.slice(-7)))
      );
    });

    if (matching) {
      targetProviderId = matching.id;
    }
  }

  // 2. Fetch candidate events (all active, planned, or confirmed events)
  let eventsQuery = supabase
    .from('itinerary_events')
    .select('id, title, description, event_date, start_time, end_time, status, sort_order, experience_provider_id, itinerary_id')
    .neq('status', 'cancelled')
    .order('event_date', { ascending: true })
    .order('start_time', { ascending: true });

  if (targetProviderId) {
    eventsQuery = eventsQuery.eq('experience_provider_id', targetProviderId);
  }

  let { data: eventsData } = await eventsQuery;

  // Fallback: If no events found for this specific provider ID (e.g. testing with WHATSAPP_TEST_RECIPIENT_PHONE),
  // retrieve the active events in the system so multi-group resolution works smoothly in all scenarios
  if ((!eventsData || eventsData.length === 0)) {
    const { data: fallbackEvents } = await supabase
      .from('itinerary_events')
      .select('id, title, description, event_date, start_time, end_time, status, sort_order, experience_provider_id, itinerary_id')
      .neq('status', 'cancelled')
      .order('event_date', { ascending: true })
      .order('start_time', { ascending: true })
      .limit(10);
    eventsData = fallbackEvents;
  }

  if (!eventsData || eventsData.length === 0) {
    return [];
  }

  // 3. Fetch linked itineraries and traveler profiles
  const itineraryIds = Array.from(new Set(eventsData.map((e) => e.itinerary_id).filter(Boolean)));
  const { data: itinerariesData } = await supabase
    .from('itineraries')
    .select('id, title, guest_count, traveler_profile_id')
    .in('id', itineraryIds);

  const profileIds = Array.from(
    new Set((itinerariesData || []).map((i) => i.traveler_profile_id).filter(Boolean))
  );
  const { data: profilesData } = await supabase
    .from('traveler_profiles')
    .select('id, name, nationality, group_size, dietary_restrictions, mobility_notes')
    .in('id', profileIds);

  const { dateStr, timeStr } = getRiyadhDateNow();

  // 4. Map and enrich candidate events
  const candidates: CandidateGroupEvent[] = eventsData.map((ev, index) => {
    const itin = itinerariesData?.find((i) => i.id === ev.itinerary_id);
    const prof = profilesData?.find((p) => p.id === itin?.traveler_profile_id);

    const startTime = (ev.start_time || '10:00').substring(0, 5);
    const endTime = (ev.end_time || '13:00').substring(0, 5);

    const timing = computeTimeContext(
      ev.event_date,
      startTime,
      endTime,
      dateStr,
      timeStr
    );

    let relativeSeqDesc = timing.timeContextDescription;
    if (eventsData && eventsData.length > 1) {
      const orderArabic =
        index === 0
          ? 'المجموعة الأولى'
          : index === 1
          ? 'المجموعة الثانية'
          : `المجموعة رقم ${index + 1}`;
      relativeSeqDesc = `${orderArabic} - ${timing.timeContextDescription}`;
    }

    return {
      eventId: ev.id,
      title: ev.title,
      eventDate: ev.event_date,
      startTime,
      endTime,
      timePeriod: timing.timePeriod,
      timeContext: timing.timeContext,
      timeContextDescription: relativeSeqDesc,
      status: ev.status,
      nationality: prof?.nationality || 'دولي',
      groupSize: prof?.group_size || itin?.guest_count || 2,
      dietaryRestrictions: prof?.dietary_restrictions || [],
      mobilityNotes: prof?.mobility_notes || '',
      description: ev.description || '',
    };
  });

  return candidates;
}

/**
 * Resolves the relevant itinerary event for a provider sending a freeform text or voice message.
 * Acts as a deterministic rule-based fallback if LLM classification does not provide matchedEventId.
 */
export async function findEventForProvider(options: {
  senderPhone?: string;
  messageText?: string;
}): Promise<string | undefined> {
  const candidates = await getProviderCandidateEvents({ senderPhone: options.senderPhone });

  if (candidates.length === 0) {
    return undefined;
  }

  if (candidates.length === 1) {
    return candidates[0].eventId;
  }

  // Multi-group heuristic matching if text is available
  if (options.messageText) {
    const normText = normalizeArabic(options.messageText);

    // Check nationality matching
    for (const cand of candidates) {
      if (cand.nationality && normText.includes(normalizeArabic(cand.nationality))) {
        console.log(`[Event Finder] 🎯 Matched group event ${cand.eventId} by nationality: ${cand.nationality}`);
        return cand.eventId;
      }
    }

    // Check group size matching (e.g. "6 أشخاص", "شخصين")
    for (const cand of candidates) {
      if (cand.groupSize && normText.includes(String(cand.groupSize))) {
        console.log(`[Event Finder] 🎯 Matched group event ${cand.eventId} by group size: ${cand.groupSize}`);
        return cand.eventId;
      }
    }

    // Check timing keywords (running now vs upcoming/later)
    const isNow = normText.includes('الحين') || normText.includes('شغال') || normText.includes('الان');
    const isUpcoming = normText.includes('بعد') || normText.includes('قادم') || normText.includes('العصر') || normText.includes('المساء') || normText.includes('الثاني');

    if (isNow) {
      const runningEvent = candidates.find((c) => c.timeContext === 'running_now');
      if (runningEvent) return runningEvent.eventId;
    }

    if (isUpcoming) {
      const upcomingEvent = candidates.find((c) => c.timeContext === 'upcoming_today' || c.status === 'planned');
      if (upcomingEvent) return upcomingEvent.eventId;
    }
  }

  // Fallback: prefer planned or active event
  const preferred = candidates.find((c) => c.status === 'planned') || candidates[0];
  return preferred?.eventId;
}
