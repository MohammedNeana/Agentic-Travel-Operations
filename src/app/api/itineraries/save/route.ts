import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseClient } from '@/lib/supabase/server';

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
    const fallbackTenantId = tenantId || 'a1b2c3d4-0001-4000-8000-000000000001';

    // 1. Fetch current existing events in the database for this itinerary
    const { data: existingEvents, error: fetchErr } = await supabase
      .from('itinerary_events')
      .select('id')
      .eq('itinerary_id', itineraryId);

    if (fetchErr) {
      console.error('Failed to fetch existing events for sync:', fetchErr);
    }

    const currentDbIds = (existingEvents || []).map((e) => e.id);
    const newEventIds = new Set(events.map((e) => e.id));

    // 2. Delete events that were removed by the user in the UI
    const idsToDelete = currentDbIds.filter((id) => !newEventIds.has(id));
    if (idsToDelete.length > 0) {
      const { error: deleteErr } = await supabase
        .from('itinerary_events')
        .delete()
        .in('id', idsToDelete);

      if (deleteErr) {
        console.error('Failed to delete removed events:', deleteErr);
      } else {
        console.log(`[Itinerary Sync] 🗑️ Deleted ${idsToDelete.length} removed events`);
      }
    }

    // 3. Upsert current local events into Supabase
    if (events.length > 0) {
      const rowsToUpsert = events.map((ev, index) => {
        // Ensure time format HH:MM:SS
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

      console.log(`[Itinerary Sync] 💾 Successfully synced ${rowsToUpsert.length} events for itinerary ${itineraryId}`);
    }

    // 4. Update updated_at timestamp on the itinerary
    await supabase
      .from('itineraries')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', itineraryId);

    return NextResponse.json({
      success: true,
      message: 'Itinerary synchronized successfully',
      eventCount: events.length,
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
