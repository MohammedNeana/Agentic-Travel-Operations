import { createServerSupabaseClient } from '@/lib/supabase/server';

export type AgentOperationType =
  | 'schedule_cascade'
  | 'status_update'
  | 'notice_dispatch'
  | 'action_boundary_block'
  | 'clarification_request'
  | 'idempotency_skip';

export interface AgentAuditEntry {
  operationId: string;
  operationType: AgentOperationType;
  tenantId?: string;
  itineraryId?: string;
  eventId?: string;
  triggerMessageId?: string;
  senderPhone?: string;
  llmModel?: string;
  latencyMs?: number;
  rationale?: string;
  validationStatus: 'passed' | 'rejected' | 'skipped';
  violations?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

const recentAuditLogs: AgentAuditEntry[] = [];
const MAX_LOG_HISTORY = 500;

export interface AuditRecordResult {
  success: boolean;
  persistedToDb: boolean;
  operationId: string;
  error?: string;
}

export async function recordAgentOperation(entry: AgentAuditEntry): Promise<AuditRecordResult> {
  const timestamp = entry.createdAt || new Date().toISOString();
  const record: AgentAuditEntry = {
    ...entry,
    createdAt: timestamp,
  };

  recentAuditLogs.unshift(record);
  if (recentAuditLogs.length > MAX_LOG_HISTORY) {
    recentAuditLogs.pop();
  }

  try {
    const supabase = createServerSupabaseClient();
    const { error: insertErr } = await supabase.from('agent_audit_log').insert({
      operation_id: record.operationId,
      operation_type: record.operationType,
      tenant_id: record.tenantId || null,
      itinerary_id: record.itineraryId || null,
      event_id: record.eventId || null,
      trigger_message_id: record.triggerMessageId || null,
      sender_phone: record.senderPhone || null,
      llm_model: record.llmModel || null,
      latency_ms: record.latencyMs || null,
      rationale: record.rationale || null,
      validation_status: record.validationStatus,
      violations: record.violations || [],
      metadata: record.metadata || {},
      created_at: timestamp,
    });

    if (insertErr) {
      record.metadata = { ...record.metadata, dbPersistenceError: insertErr.message };
      return { success: true, persistedToDb: false, operationId: record.operationId, error: insertErr.message };
    }

    return { success: true, persistedToDb: true, operationId: record.operationId };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Database audit insert failed';
    record.metadata = { ...record.metadata, dbPersistenceError: message };
    return { success: true, persistedToDb: false, operationId: record.operationId, error: message };
  }
}

export function getRecentAgentAuditLogs(limit = 50): AgentAuditEntry[] {
  return recentAuditLogs.slice(0, limit);
}

export function clearAuditLogs(): void {
  recentAuditLogs.length = 0;
}
