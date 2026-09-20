import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { CandidateGroupEvent } from './types';

export interface EventUpdateResult {
  success: boolean;
  eventId?: string;
  previousStatus?: string;
  newStatus?: string;
  title?: string;
  error?: string;
  requiresHumanEscalation?: boolean;
}

export async function confirmItineraryEvent(eventId: string): Promise<EventUpdateResult> {
  const supabase = createServerSupabaseClient();

  const { data: event, error: fetchError } = await supabase
    .from('itinerary_events')
    .select('id, title, status')
    .eq('id', eventId)
    .single();

  if (fetchError || !event) {
    return {
      success: false,
      eventId,
      error: `Event ${eventId} not found in database.`,
    };
  }

  const { error: updateError } = await supabase
    .from('itinerary_events')
    .update({
      status: 'confirmed',
      updated_at: new Date().toISOString(),
    })
    .eq('id', eventId);

  if (updateError) {
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
    newStatus: 'cancelled',
    title: event.title,
  };
}

function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u065F\u0670]/g, '')
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

export async function escalateItineraryEvent(options?: {
  eventId?: string;
  transcriptionText?: string;
  reason?: string;
  senderPhone?: string;
}): Promise<EventUpdateResult> {
  const supabase = createServerSupabaseClient();
  let targetEventId = options?.eventId;

  if (!targetEventId) {
    const { data: allActiveEvents, error: lookupError } = await supabase
      .from('itinerary_events')
      .select('id, title, description, status, event_date, start_time')
      .neq('status', 'cancelled')
      .order('event_date', { ascending: true })
      .order('sort_order', { ascending: true });

    if (lookupError || !allActiveEvents || allActiveEvents.length === 0) {
      return {
        success: false,
        error: 'No active itinerary events found for escalation.',
      };
    }

    if (options?.transcriptionText && options.transcriptionText.trim().length > 0) {
      const normTrans = normalizeArabic(options.transcriptionText);
      const transWords = normTrans.split(/\s+/).filter(w => w.length >= 2 && !ARABIC_STOP_WORDS.has(w));

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

      if (bestScore > 0 && bestEvent) {
        targetEventId = bestEvent.id;
      } else {
        return {
          success: false,
          error: 'No active event matches the transcription keywords with sufficient confidence.',
          requiresHumanEscalation: true,
        };
      }
    } else {
      return {
        success: false,
        error: 'No event ID or transcription text provided for targeted escalation.',
        requiresHumanEscalation: true,
      };
    }
  }

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
    return {
      success: false,
      eventId: targetEventId,
      previousStatus: currentEvent.status,
      error: updateErr.message,
    };
  }

  return {
    success: true,
    eventId: targetEventId,
    previousStatus: currentEvent.status,
    newStatus: 'escalated',
    title: currentEvent.title,
  };
}

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

export async function getProviderCandidateEvents(options: {
  senderPhone?: string;
  providerId?: string;
}): Promise<CandidateGroupEvent[]> {
  const supabase = createServerSupabaseClient();
  let targetProviderId = options.providerId;

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

  if (!eventsData || eventsData.length === 0) {
    return [];
  }

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

  if (options.messageText) {
    const normText = normalizeArabic(options.messageText);

    for (const cand of candidates) {
      if (cand.nationality && normText.includes(normalizeArabic(cand.nationality))) {
        return cand.eventId;
      }
    }

    for (const cand of candidates) {
      if (cand.groupSize && normText.includes(String(cand.groupSize))) {
        return cand.eventId;
      }
    }

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

  const preferred = candidates.find((c) => c.status === 'planned') || candidates[0];
  return preferred?.eventId;
}
