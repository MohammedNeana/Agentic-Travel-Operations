export type AgentOperationType =
  | 'schedule_cascade'
  | 'status_update'
  | 'notice_dispatch'
  | 'action_boundary_block'
  | 'clarification_request'
  | 'idempotency_skip'
  | 'transaction_rollback';

export interface AuditEntry {
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

export interface AuditRecordResult {
  success: boolean;
  persistedToDb: boolean;
  operationId: string;
  error?: string;
}

export interface AuditLogPort {
  record(entry: AuditEntry): Promise<AuditRecordResult>;
}

export type AgentAuditEntry = AuditEntry;

