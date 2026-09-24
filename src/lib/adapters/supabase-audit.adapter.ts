import { AuditLogPort, AuditEntry, AuditRecordResult } from '@/lib/ports/audit-log.port';
import { recordAgentOperation } from '@/lib/agent/audit-log';

export class SupabaseAuditAdapter implements AuditLogPort {
  async record(entry: AuditEntry): Promise<AuditRecordResult> {
    return recordAgentOperation(entry);
  }
}
