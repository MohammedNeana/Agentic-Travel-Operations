import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import { sendProviderNotification } from '@/lib/whatsapp/sender';

export const dynamic = 'force-dynamic';

interface SaveEventPayload {
  id: string;
  tenantId?: string;
  itineraryId?: string;
  experienceProviderId?: string | null;
  title: string;
  description?: string | null;
  eventDate: string;
  startTime: string;
  endTime: string;
  sortOrder: number;
  status: 'planned' | 'confirmed' | 'cancelled' | 'escalated';
  escalationReason?: string | null;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { itineraryId, tenantId, events } = body as {
      itineraryId: string;
      tenantId?: string;
      events: SaveEventPayload[];
    };

    if (!itineraryId) {
      return NextResponse.json(
        { success: false, error: 'itineraryId is required' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const fallbackTenantId = tenantId;

    // 1. Fetch current existing events in the database for this itinerary
    const { data: existingEvents, error: fetchErr } = await supabase
      .from('itinerary_events')
      .select('id')
      .eq('itinerary_id', itineraryId);

    if (fetchErr) {
      console.error('Failed to fetch existing events for sync:', fetchErr);
    }

    const currentDbIds = (existingEvents || []).map((e) => e.id);
    const existingDbIdSet = new Set(currentDbIds);
    const newEventIds = new Set(events.map((e) => e.id));

    // Detect events that are genuinely newly added in this save action
    const newlyAddedEvents = events.filter((ev) => !existingDbIdSet.has(ev.id));


    // 2. Delete events that were removed by the user
    const idsToDelete = currentDbIds.filter((id) => !newEventIds.has(id));
    if (idsToDelete.length > 0) {
      const { error: deleteErr } = await supabase
        .from('itinerary_events')
        .delete()
        .in('id', idsToDelete);

      if (deleteErr) {
        console.error('Failed to delete removed events:', deleteErr);
      } else {
        console.log(`Deleted ${idsToDelete.length} removed events`);
      }
    }

    // 3. Upsert current local events into Supabase
    if (events.length > 0) {
      const rowsToUpsert = events.map((ev, index) => {
        const start = ev.startTime
          ? ev.startTime.length === 5
            ? `${ev.startTime}:00`
            : ev.startTime
          : '10:00:00';
        const end = ev.endTime
          ? ev.endTime.length === 5
            ? `${ev.endTime}:00`
            : ev.endTime
          : '13:00:00';

        return {
          id: ev.id,
          tenant_id: ev.tenantId || fallbackTenantId,
          itinerary_id: itineraryId,
          experience_provider_id: ev.experienceProviderId || null,
          title: ev.title,
          description: ev.description || null,
          event_date: ev.eventDate,
          start_time: start,
          end_time: end,
          sort_order: ev.sortOrder || index + 1,
          status: ev.status || 'planned',
          escalation_reason: ev.escalationReason || null,
          updated_at: new Date().toISOString(),
        };
      });

      const { error: upsertErr } = await supabase
        .from('itinerary_events')
        .upsert(rowsToUpsert, { onConflict: 'id' });

      if (upsertErr) {
        console.error('Failed to upsert itinerary events:', upsertErr);
        return NextResponse.json(
          { success: false, error: upsertErr.message },
          { status: 500 }
        );
      }

      console.log(`Successfully synced ${rowsToUpsert.length} events for itinerary ${itineraryId}`);
    }

    // 4. Update updated_at timestamp on the itinerary
    await supabase
      .from('itineraries')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', itineraryId);

    // 5. Send outbound WhatsApp booking notifications for newly added events
    const outboundNotifications: Array<{
      eventId: string;
      title: string;
      recipientPhone?: string;
      status: 'sent' | 'failed' | 'skipped';
      messageId?: string;
      error?: string;
    }> = [];

    if (newlyAddedEvents.length > 0) {
      console.log(
        `Detected ${newlyAddedEvents.length} newly added events. Triggering provider notifications...`
      );

      for (const ev of newlyAddedEvents) {
        // Only notify planned events
        if (ev.status && ev.status !== 'planned') {
          continue;
        }

        let providerPhone: string | null = null;
        let providerName: string = ev.title;

        // Fetch experience provider phone from DB if available
        if (ev.experienceProviderId) {
          const { data: providerData } = await supabase
            .from('experience_providers')
            .select('name, phone_number, phone')
            .eq('id', ev.experienceProviderId)
            .single();

          if (providerData) {
            providerPhone = providerData.phone_number || providerData.phone || null;
            providerName = providerData.name || ev.title;
          }
        }

        const notifyResult = await sendProviderNotification(providerPhone || '', {
          id: ev.id,
          title: ev.title,
          date: ev.eventDate,
          time: ev.startTime,
          providerName,
        });

        outboundNotifications.push({
          eventId: ev.id,
          title: ev.title,
          recipientPhone: notifyResult.recipientPhone,
          status: notifyResult.success ? 'sent' : 'failed',
          messageId: notifyResult.messageId,
          error: notifyResult.error,
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: 'Itinerary synchronized successfully',
      eventCount: events.length,
      newEventsCount: newlyAddedEvents.length,
      outboundNotifications,
    });
  } catch (error) {
    console.error('Error in POST /api/itineraries/save:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error',
      },
      { status: 500 }
    );
  }
}
