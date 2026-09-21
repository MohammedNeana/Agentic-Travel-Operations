import { SupabaseClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import { OutboxNoticeRecord } from './types';
import { sendWhatsAppTextMessage } from './sender';

const memoryOutbox: OutboxNoticeRecord[] = [];
const MAX_MEMORY_OUTBOX_LIMIT = 500;

export async function stageOutboxNotices(
  supabase: SupabaseClient,
  notices: Array<{
    eventId: string;
    providerName?: string;
    providerPhone: string;
    message: string;
  }>,
  tenantId: string
): Promise<OutboxNoticeRecord[]> {
  const staged: OutboxNoticeRecord[] = notices.map((notice) => ({
    id: crypto.randomUUID(),
    tenantId,
    eventId: notice.eventId,
    providerName: notice.providerName,
    providerPhone: notice.providerPhone,
    message: notice.message,
    status: 'pending',
    attempts: 0,
    createdAt: new Date().toISOString(),
  }));

  for (const item of staged) {
    memoryOutbox.unshift(item);
    if (memoryOutbox.length > MAX_MEMORY_OUTBOX_LIMIT) {
      memoryOutbox.pop();
    }
  }

  try {
    const rows = staged.map((item) => ({
      id: item.id,
      tenant_id: item.tenantId,
      event_id: item.eventId,
      recipient_phone: item.providerPhone,
      provider_name: item.providerName || null,
      message_payload: item.message,
      status: item.status,
      attempts: item.attempts || 0,
      created_at: item.createdAt,
    }));

    await supabase.from('notification_outbox').insert(rows);
  } catch {}

  return staged;
}

export async function dispatchPendingOutboxNotices(
  supabase: SupabaseClient,
  notices: OutboxNoticeRecord[]
): Promise<{ dispatchedCount: number; updatedNotices: OutboxNoticeRecord[] }> {
  let dispatchedCount = 0;
  const updatedNotices: OutboxNoticeRecord[] = [];

  for (const item of notices) {
    const nextAttempts = (item.attempts || 0) + 1;
    const sendRes = await sendWhatsAppTextMessage(item.providerPhone, item.message);

    let nextStatus: 'dispatched' | 'failed' = 'failed';
    let dispatchedAt: string | undefined = undefined;
    let errorMsg: string | undefined = undefined;

    if (sendRes.success) {
      nextStatus = 'dispatched';
      dispatchedAt = new Date().toISOString();
      dispatchedCount++;
    } else {
      nextStatus = 'failed';
      errorMsg = sendRes.error || 'Failed to dispatch notification';
    }

    const updated: OutboxNoticeRecord = {
      ...item,
      status: nextStatus,
      attempts: nextAttempts,
      dispatchedAt,
      error: errorMsg,
    };

    updatedNotices.push(updated);

    const memIdx = memoryOutbox.findIndex((m) => m.id === item.id);
    if (memIdx >= 0) {
      memoryOutbox[memIdx] = updated;
    }

    try {
      let updateQuery = supabase
        .from('notification_outbox')
        .update({
          status: nextStatus,
          attempts: nextAttempts,
          dispatched_at: dispatchedAt || null,
          error: errorMsg || null,
        })
        .eq('id', item.id);

      if (item.tenantId) {
        updateQuery = updateQuery.eq('tenant_id', item.tenantId);
      }

      await updateQuery;
    } catch {}
  }

  return { dispatchedCount, updatedNotices };
}

export async function fetchPendingOutboxNotices(
  supabase: SupabaseClient,
  tenantId?: string
): Promise<OutboxNoticeRecord[]> {
  try {
    let query = supabase
      .from('notification_outbox')
      .select('id, tenant_id, event_id, recipient_phone, provider_name, message_payload, status, attempts, created_at, dispatched_at, error')
      .eq('status', 'pending')
      .order('created_at', { ascending: true })
      .limit(50);

    if (tenantId) {
      query = query.eq('tenant_id', tenantId);
    }

    const { data, error } = await query;
    if (!error && data && data.length > 0) {
      return data.map((row) => ({
        id: row.id,
        tenantId: row.tenant_id,
        eventId: row.event_id,
        providerName: row.provider_name || undefined,
        providerPhone: row.recipient_phone,
        message: row.message_payload,
        status: row.status as 'pending' | 'dispatched' | 'failed',
        attempts: row.attempts,
        createdAt: row.created_at,
        dispatchedAt: row.dispatched_at || undefined,
        error: row.error || undefined,
      }));
    }
  } catch {}

  return memoryOutbox.filter((m) => {
    if (tenantId && m.tenantId && m.tenantId !== tenantId) {
      return false;
    }
    return m.status === 'pending';
  });
}
