import { OutboxRecord } from './notification.port';
import { AgentAuditEntry } from '../agent/audit-log';

export interface ItineraryEventRecord {
  id: string;
  itinerary_id: string;
  tenant_id: string;
  event_date: string;
  start_time: string;
  end_time: string;
  title: string;
  status: string;
  sort_order: number;
  experience_provider_id: string;
  escalation_reason?: string | null;
  is_immutable?: boolean;
  updated_at?: string;
}

export interface ItineraryRecord {
  id: string;
  title: string;
  guest_count: number;
  traveler_profile_id: string;
  tenant_id: string;
}

export interface TravelerProfileRecord {
  id: string;
  name?: string;
  nationality?: string;
  group_size?: number;
  dietary_restrictions?: string[];
  mobility_notes?: string;
  tenant_id: string;
}

export interface ExperienceProviderRecord {
  id: string;
  name: string;
  phone_number?: string;
  city?: string;
  experience_type?: string;
  tenant_id: string;
}

export interface EventUpdatePayload {
  id: string;
  startTime: string;
  endTime: string;
  status: string;
  escalationReason?: string;
}

export interface EventSnapshotRecord {
  id: string;
  start_time: string;
  end_time: string;
  status: string;
  escalation_reason?: string | null;
  updated_at?: string;
}

export interface AtomicCascadeAdjustment {
  eventId: string;
  startTime: string;
  endTime: string;
  status: string;
  escalationReason?: string;
}

export interface AtomicCascadeOutboxNotice {
  eventId: string;
  providerName?: string;
  providerPhone: string;
  message: string;
}

export interface AtomicCascadeParams {
  tenantId: string;
  adjustments: AtomicCascadeAdjustment[];
  outboxNotices: AtomicCascadeOutboxNotice[];
  auditEntry: AgentAuditEntry;
}

export interface AtomicCascadeResult {
  success: boolean;
  updatedEventsCount: number;
  stagedOutboxNotices: OutboxRecord[];
  error?: string;
}

export interface ItineraryRepository {
  getTargetEvent(eventId: string, tenantId?: string): Promise<ItineraryEventRecord | null>;
  getDayEvents(itineraryId: string, eventDate: string, tenantId?: string): Promise<ItineraryEventRecord[]>;
  getItinerary(itineraryId: string, tenantId?: string): Promise<ItineraryRecord | null>;
  getTravelerProfile(profileId: string, tenantId?: string): Promise<TravelerProfileRecord | null>;
  getSnapshots(eventIds: string[], tenantId?: string): Promise<EventSnapshotRecord[]>;
  updateEvent(update: EventUpdatePayload, tenantId?: string): Promise<boolean>;
  rollbackEvent(snapshot: EventSnapshotRecord, tenantId?: string): Promise<void>;
  executeAtomicCascade(params: AtomicCascadeParams): Promise<AtomicCascadeResult>;
}

export interface SupplierRepository {
  findProviderByPhone(phone: string, tenantId?: string): Promise<ExperienceProviderRecord | null>;
  getProviders(tenantId?: string): Promise<ExperienceProviderRecord[]>;
}
