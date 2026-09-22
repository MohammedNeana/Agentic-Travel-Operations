import { SupabaseClient } from '@supabase/supabase-js';
import {
  ItineraryRepository,
  SupplierRepository,
  ItineraryEventRecord,
  ItineraryRecord,
  TravelerProfileRecord,
  ExperienceProviderRecord,
  EventUpdatePayload,
  EventSnapshotRecord,
  AtomicCascadeParams,
  AtomicCascadeResult,
} from '../ports/repository.port';
import { stageOutboxNotices } from '../whatsapp/outbox';
import { recordAgentOperation } from '../agent/audit-log';
import { OutboxRecord } from '../ports/notification.port';

export class SupabaseItineraryRepository implements ItineraryRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async getTargetEvent(eventId: string, tenantId?: string): Promise<ItineraryEventRecord | null> {
    let query = this.supabase.from('itinerary_events').select('*').eq('id', eventId);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query.single();
    if (error || !data) {
      return null;
    }
    return data as ItineraryEventRecord;
  }

  async getDayEvents(itineraryId: string, eventDate: string, tenantId?: string): Promise<ItineraryEventRecord[]> {
    let query = this.supabase
      .from('itinerary_events')
      .select('*')
      .eq('itinerary_id', itineraryId)
      .eq('event_date', eventDate)
      .order('sort_order', { ascending: true });
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query;
    if (error || !data) {
      return [];
    }
    return data as ItineraryEventRecord[];
  }

  async getItinerary(itineraryId: string, tenantId?: string): Promise<ItineraryRecord | null> {
    let query = this.supabase
      .from('itineraries')
      .select('id, title, guest_count, traveler_profile_id, tenant_id')
      .eq('id', itineraryId);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query.single();
    if (error || !data) {
      return null;
    }
    return data as ItineraryRecord;
  }

  async getTravelerProfile(profileId: string, tenantId?: string): Promise<TravelerProfileRecord | null> {
    let query = this.supabase
      .from('traveler_profiles')
      .select('id, name, nationality, group_size, dietary_restrictions, mobility_notes, tenant_id')
      .eq('id', profileId);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query.single();
    if (error || !data) {
      return null;
    }
    return data as TravelerProfileRecord;
  }

  async getSnapshots(eventIds: string[], tenantId?: string): Promise<EventSnapshotRecord[]> {
    if (eventIds.length === 0) {
      return [];
    }
    let query = this.supabase
      .from('itinerary_events')
      .select('id, start_time, end_time, status, escalation_reason, updated_at')
      .in('id', eventIds);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query;
    if (error || !data) {
      return [];
    }
    return data as EventSnapshotRecord[];
  }

  async updateEvent(update: EventUpdatePayload, tenantId?: string): Promise<boolean> {
    let query = this.supabase
      .from('itinerary_events')
      .update({
        start_time: update.startTime,
        end_time: update.endTime,
        status: update.status,
        escalation_reason: update.escalationReason || null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', update.id);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { error } = await query;
    return !error;
  }

  async rollbackEvent(snapshot: EventSnapshotRecord, tenantId?: string): Promise<void> {
    let query = this.supabase
      .from('itinerary_events')
      .update({
        start_time: snapshot.start_time,
        end_time: snapshot.end_time,
        status: snapshot.status,
        escalation_reason: snapshot.escalation_reason,
        updated_at: snapshot.updated_at,
      })
      .eq('id', snapshot.id);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    await query;
  }

  async executeAtomicCascade(params: AtomicCascadeParams): Promise<AtomicCascadeResult> {
    if (typeof (this.supabase as any).rpc === 'function') {
      try {
        const { data, error } = await this.supabase.rpc('execute_itinerary_atomic_cascade', {
          p_tenant_id: params.tenantId,
          p_adjustments: params.adjustments,
          p_outbox_notices: params.outboxNotices,
          p_audit_entry: params.auditEntry,
        });
        if (!error && data && data.success) {
          return {
            success: true,
            updatedEventsCount: data.updated_count || params.adjustments.length,
            stagedOutboxNotices: (data.staged_notices || []).map((n: any) => ({
              id: n.id,
              tenantId: n.tenant_id,
              eventId: n.event_id,
              providerName: n.provider_name,
              providerPhone: n.recipient_phone,
              message: n.message_payload,
              status: n.status,
              attempts: n.attempts,
              createdAt: n.created_at,
              dispatchedAt: n.dispatched_at,
              error: n.error,
            })),
          };
        }
      } catch {}
    }

    const targetIds = params.adjustments.map((a) => a.eventId);
    const snapshots = await this.getSnapshots(targetIds, params.tenantId);

    const successfullyUpdated: string[] = [];
    let failureReason = '';

    for (const adj of params.adjustments) {
      const ok = await this.updateEvent(
        {
          id: adj.eventId,
          startTime: adj.startTime,
          endTime: adj.endTime,
          status: adj.status,
          escalationReason: adj.escalationReason,
        },
        params.tenantId
      );

      if (!ok) {
        failureReason = `Failed to update event ${adj.eventId}`;
        break;
      }
      successfullyUpdated.push(adj.eventId);
    }

    if (failureReason) {
      const toRevert = snapshots.filter((s) => successfullyUpdated.includes(s.id));
      for (const snap of toRevert) {
        await this.rollbackEvent(snap, params.tenantId);
      }
      return {
        success: false,
        updatedEventsCount: 0,
        stagedOutboxNotices: [],
        error: failureReason,
      };
    }

    let stagedNotices: OutboxRecord[] = [];
    try {
      const outboxRaw = await stageOutboxNotices(
        this.supabase,
        params.outboxNotices.map((n) => ({
          eventId: n.eventId,
          providerName: n.providerName,
          providerPhone: n.providerPhone,
          message: n.message,
        })),
        params.tenantId
      );

      stagedNotices = outboxRaw.map((n) => ({
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
      }));
    } catch (err) {
      failureReason = `Outbox staging failure: ${err instanceof Error ? err.message : String(err)}`;
      const toRevert = snapshots.filter((s) => successfullyUpdated.includes(s.id));
      for (const snap of toRevert) {
        await this.rollbackEvent(snap, params.tenantId);
      }
      return {
        success: false,
        updatedEventsCount: 0,
        stagedOutboxNotices: [],
        error: failureReason,
      };
    }

    try {
      await recordAgentOperation(params.auditEntry);
    } catch (err) {
      failureReason = `Audit persistence failure: ${err instanceof Error ? err.message : String(err)}`;
      const toRevert = snapshots.filter((s) => successfullyUpdated.includes(s.id));
      for (const snap of toRevert) {
        await this.rollbackEvent(snap, params.tenantId);
      }
      return {
        success: false,
        updatedEventsCount: 0,
        stagedOutboxNotices: [],
        error: failureReason,
      };
    }

    return {
      success: true,
      updatedEventsCount: successfullyUpdated.length,
      stagedOutboxNotices: stagedNotices,
    };
  }
}

export class SupabaseSupplierRepository implements SupplierRepository {
  constructor(private readonly supabase: SupabaseClient) {}

  async findProviderByPhone(phone: string, tenantId?: string): Promise<ExperienceProviderRecord | null> {
    let query = this.supabase
      .from('experience_providers')
      .select('id, name, phone_number, city, experience_type, tenant_id')
      .eq('phone_number', phone);
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return null;
    }
    return data as ExperienceProviderRecord;
  }

  async getProviders(tenantId?: string): Promise<ExperienceProviderRecord[]> {
    let query = this.supabase
      .from('experience_providers')
      .select('id, name, phone_number, city, experience_type, tenant_id');
    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }
    const { data, error } = await query;
    if (error || !data) {
      return [];
    }
    return data as ExperienceProviderRecord[];
  }
}
