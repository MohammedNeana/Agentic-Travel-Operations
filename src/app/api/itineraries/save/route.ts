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
    const {
      itineraryId,
      tenantId,
      events,
      travelerNationality,
      groupSize,
      dietaryRestrictions,
      mobilityNotes,
      additionalNotes,
    } = body as {
      itineraryId: string;
      tenantId?: string;
      events: SaveEventPayload[];
      travelerNationality?: string;
      groupSize?: number;
      dietaryRestrictions?: string[];
      mobilityNotes?: string;
      additionalNotes?: string;
    };

    if (!itineraryId) {
      return NextResponse.json(
        { success: false, error: 'itineraryId is required' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseClient();
    const fallbackTenantId = tenantId;

    let finalNationality = travelerNationality;
    let finalGroupSize = groupSize;
    let finalDietary = dietaryRestrictions;
    let finalMobility = mobilityNotes;

    if (!finalNationality || !finalGroupSize || !finalDietary || !finalMobility) {
      const { data: itinData } = await supabase
        .from('itineraries')
        .select('guest_count, traveler_profile_id')
        .eq('id', itineraryId)
        .single();

      if (itinData) {
        if (!finalGroupSize) finalGroupSize = itinData.guest_count;
        if (itinData.traveler_profile_id) {
          const { data: profileData } = await supabase
            .from('traveler_profiles')
            .select('nationality, group_size, dietary_restrictions, mobility_notes')
            .eq('id', itinData.traveler_profile_id)
            .single();

          if (profileData) {
            if (!finalNationality) finalNationality = profileData.nationality;
            if (!finalGroupSize) finalGroupSize = profileData.group_size;
            if (!finalDietary) finalDietary = profileData.dietary_restrictions;
            if (!finalMobility) finalMobility = profileData.mobility_notes;
          }
        }
      }
    }

    const { data: existingEvents } = await supabase
      .from('itinerary_events')
      .select('id')
      .eq('itinerary_id', itineraryId);

    const currentDbIds = (existingEvents || []).map((e) => e.id);
    const existingDbIdSet = new Set(currentDbIds);
    const newEventIds = new Set(events.map((e) => e.id));

    const newlyAddedEvents = events.filter((ev) => !existingDbIdSet.has(ev.id));

    const idsToDelete = currentDbIds.filter((id) => !newEventIds.has(id));
    if (idsToDelete.length > 0) {
      await supabase
        .from('itinerary_events')
        .delete()
        .in('id', idsToDelete);
    }

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
        return NextResponse.json(
          { success: false, error: upsertErr.message },
          { status: 500 }
        );
      }
    }

    await supabase
      .from('itineraries')
      .update({ updated_at: new Date().toISOString() })
      .eq('id', itineraryId);

    const outboundNotifications: Array<{
      eventId: string;
      title: string;
      recipientPhone?: string;
      status: 'sent' | 'failed' | 'skipped';
      messageId?: string;
      error?: string;
    }> = [];

    if (newlyAddedEvents.length > 0) {
      for (const ev of newlyAddedEvents) {
        if (ev.status && ev.status !== 'planned') {
          continue;
        }

        let providerPhone: string | null = null;
        let providerName: string = ev.title;

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
          endTime: ev.endTime,
          groupNationality: finalNationality || 'دولي',
          groupSize: finalGroupSize || 2,
          dietaryRestrictions: finalDietary,
          mobilityNotes: finalMobility,
          notes: ev.description || additionalNotes,
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
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown sync error',
      },
      { status: 500 }
    );
  }
}
