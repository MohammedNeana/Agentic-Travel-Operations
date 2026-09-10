import { createServerSupabaseClient } from '@/lib/supabase/server';

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

  // Update status to 'escalated'
  const { error: updateErr } = await supabase
    .from('itinerary_events')
    .update({
      status: 'escalated',
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
