import { SupabaseClient } from '@supabase/supabase-js';
import { OutboxRepositoryPort, ClaimBatchParams } from '@/lib/ports/outbox-repository.port';
import { OutboxMessageItem } from '@/lib/outbox/outbox-worker';

export class SupabaseOutboxAdapter implements OutboxRepositoryPort {
  constructor(private readonly supabase: SupabaseClient) {}

  async claimBatch(params: ClaimBatchParams): Promise<OutboxMessageItem[]> {
    const { workerId, batchSize = 20, leaseSeconds = 30, tenantId } = params;

    const { data, error } = await this.supabase.rpc('claim_outbox_batch', {
      p_worker_id: workerId,
      p_batch_size: batchSize,
      p_lease_seconds: leaseSeconds,
      p_tenant_id: tenantId || null,
    });

    if (error) {
      throw new Error(`Atomic outbox claim failed via claim_outbox_batch RPC: ${error.message}`);
    }

    if (!Array.isArray(data)) {
      return [];
    }

    return data.map((row: any) => ({
      id: row.id,
      tenantId: row.tenant_id,
      eventId: row.event_id,
      recipientPhone: row.recipient_phone,
      providerName: row.provider_name || undefined,
      message: row.message_payload || row.message || '',
      status: row.status,
      attempts: row.attempts,
      maxAttempts: 5,
      nextRetryAt: row.next_retry_at ? new Date(row.next_retry_at).getTime() : undefined,
      dispatchedAt: row.dispatched_at || undefined,
      deadLetterReason: row.dead_letter_reason || undefined,
      idempotencyKey: row.idempotency_key || '',
      createdAt: row.created_at,
      lastError: row.error || undefined,
      lockedBy: row.locked_by || undefined,
      lockedAt: row.locked_at || undefined,
      leaseExpiresAt: row.lease_expires_at ? new Date(row.lease_expires_at).getTime() : undefined,
    }));
  }

  async markDispatched(id: string, dispatchedAt: string, tenantId?: string): Promise<void> {
    let q = this.supabase
      .from('notification_outbox')
      .update({
        status: 'dispatched',
        dispatched_at: dispatchedAt,
        locked_by: null,
        lease_expires_at: null,
        error: null,
      })
      .eq('id', id);

    if (tenantId) {
      q = q.eq('tenant_id', tenantId);
    }

    await q;
  }

  async markFailed(id: string, nextRetryAt: number, error: string, tenantId?: string): Promise<void> {
    let q = this.supabase
      .from('notification_outbox')
      .update({
        status: 'failed',
        next_retry_at: new Date(nextRetryAt).toISOString(),
        error,
        locked_by: null,
        lease_expires_at: null,
      })
      .eq('id', id);

    if (tenantId) {
      q = q.eq('tenant_id', tenantId);
    }

    await q;
  }

  async markDeadLetter(id: string, reason: string, tenantId?: string): Promise<void> {
    let q = this.supabase
      .from('notification_outbox')
      .update({
        status: 'dead_letter',
        dead_letter_reason: reason,
        locked_by: null,
        lease_expires_at: null,
      })
      .eq('id', id);

    if (tenantId) {
      q = q.eq('tenant_id', tenantId);
    }

    await q;
  }
}
