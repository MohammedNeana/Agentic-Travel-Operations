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

/**
 * Updates an itinerary event status to 'escalated'.
 * Triggered when a voice note is classified as 'Emergency' or 'Delay'.
 * If no specific eventId is provided, finds the nearest active or upcoming planned/confirmed event.
 */
export async function escalateItineraryEvent(options?: {
  eventId?: string;
  reason?: string;
  senderPhone?: string;
}): Promise<EventUpdateResult> {
  const supabase = createServerSupabaseClient();
  let targetEventId = options?.eventId;

  // If no explicit eventId is provided, find the active or next planned/confirmed event
  if (!targetEventId) {
    const { data: upcomingEvents, error: lookupError } = await supabase
      .from('itinerary_events')
      .select('id, title, status, event_date, start_time')
      .neq('status', 'cancelled')
      .order('event_date', { ascending: true })
      .order('sort_order', { ascending: true })
      .limit(1);

    if (lookupError || !upcomingEvents || upcomingEvents.length === 0) {
      console.warn('No active or upcoming events found to escalate:', lookupError);
      return {
        success: false,
        error: 'No active or upcoming itinerary events found for escalation.',
      };
    }

    targetEventId = upcomingEvents[0].id;
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

  return {
    success: true,
    eventId: targetEventId,
    previousStatus: currentEvent.status,
    newStatus: 'escalated',
    title: currentEvent.title,
  };
}
