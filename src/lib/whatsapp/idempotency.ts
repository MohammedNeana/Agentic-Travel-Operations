import { createServerSupabaseClient } from '@/lib/supabase/server';

export type MessageProcessingState = 'received' | 'processing' | 'completed' | 'failed';

export interface MessageIdempotencyRecord {
  messageId: string;
  status: MessageProcessingState;
  updatedAt: number;
  details?: Record<string, unknown>;
  error?: string;
}

const IN_FLIGHT_LEASE_MS = 2 * 60 * 1000;
const COMPLETED_TTL_MS = 24 * 60 * 60 * 1000;
const inMemoryStore = new Map<string, MessageIdempotencyRecord>();

function isDuplicateConflictError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { code?: string; message?: string; details?: string };
  if (e.code === '23505') return true;
  const text = `${e.message || ''} ${e.details || ''}`.toLowerCase();
  return text.includes('duplicate') || text.includes('unique') || text.includes('conflict');
}

export async function acquireMessageProcessingLock(messageId: string): Promise<{
  acquired: boolean;
  state?: MessageProcessingState;
}> {
  if (!messageId || typeof messageId !== 'string') {
    return { acquired: false };
  }

  const now = Date.now();

  try {
    const supabase = createServerSupabaseClient();
    const { data: existing } = await supabase
      .from('whatsapp_messages')
      .select('status, updated_at')
      .eq('message_id', messageId)
      .maybeSingle();

    if (existing) {
      if (existing.status === 'completed') {
        return { acquired: false, state: 'completed' };
      }
      const lastUpdate = existing.updated_at ? new Date(existing.updated_at).getTime() : 0;
      if (existing.status === 'processing' && now - lastUpdate < IN_FLIGHT_LEASE_MS) {
        return { acquired: false, state: 'processing' };
      }

      const { data: updatedRows, error: updateErr } = await supabase
        .from('whatsapp_messages')
        .update({
          status: 'processing',
          updated_at: new Date(now).toISOString(),
        })
        .eq('message_id', messageId)
        .eq('updated_at', existing.updated_at)
        .select('message_id');

      if (!updateErr && updatedRows && updatedRows.length > 0) {
        inMemoryStore.set(messageId, {
          messageId,
          status: 'processing',
          updatedAt: now,
        });
        return { acquired: true, state: 'processing' };
      }

      return { acquired: false, state: existing.status };
    }

    const { error: insertErr } = await supabase
      .from('whatsapp_messages')
      .insert({
        message_id: messageId,
        status: 'processing',
        updated_at: new Date(now).toISOString(),
      });

    if (!insertErr) {
      inMemoryStore.set(messageId, {
        messageId,
        status: 'processing',
        updatedAt: now,
      });
      return { acquired: true, state: 'processing' };
    }

    if (isDuplicateConflictError(insertErr)) {
      const { data: conflictRow } = await supabase
        .from('whatsapp_messages')
        .select('status, updated_at')
        .eq('message_id', messageId)
        .maybeSingle();

      if (conflictRow) {
        if (conflictRow.status === 'completed') {
          return { acquired: false, state: 'completed' };
        }
        const lastUpdate = conflictRow.updated_at ? new Date(conflictRow.updated_at).getTime() : 0;
        if (conflictRow.status === 'processing' && now - lastUpdate < IN_FLIGHT_LEASE_MS) {
          return { acquired: false, state: 'processing' };
        }
      }
      return { acquired: false, state: conflictRow?.status || 'processing' };
    }
  } catch {}

  const mem = inMemoryStore.get(messageId);
  if (mem) {
    if (mem.status === 'completed') {
      if (now - mem.updatedAt < COMPLETED_TTL_MS) {
        return { acquired: false, state: 'completed' };
      }
      inMemoryStore.delete(messageId);
    } else if (mem.status === 'processing') {
      if (now - mem.updatedAt < IN_FLIGHT_LEASE_MS) {
        return { acquired: false, state: 'processing' };
      }
    }
  }

  inMemoryStore.set(messageId, {
    messageId,
    status: 'processing',
    updatedAt: now,
  });

  return { acquired: true, state: 'processing' };
}

export async function markMessageCompleted(
  messageId: string,
  details?: Record<string, unknown>
): Promise<void> {
  if (!messageId || typeof messageId !== 'string') return;
  const now = Date.now();

  inMemoryStore.set(messageId, {
    messageId,
    status: 'completed',
    updatedAt: now,
    details,
  });

  try {
    const supabase = createServerSupabaseClient();
    await supabase
      .from('whatsapp_messages')
      .update({
        status: 'completed',
        updated_at: new Date(now).toISOString(),
        metadata: details || {},
      })
      .eq('message_id', messageId);
  } catch {}
}

export async function markMessageFailed(
  messageId: string,
  error?: string
): Promise<void> {
  if (!messageId || typeof messageId !== 'string') return;
  const now = Date.now();

  inMemoryStore.set(messageId, {
    messageId,
    status: 'failed',
    updatedAt: now,
    error,
  });

  try {
    const supabase = createServerSupabaseClient();
    await supabase
      .from('whatsapp_messages')
      .update({
        status: 'failed',
        updated_at: new Date(now).toISOString(),
        error_message: error || null,
      })
      .eq('message_id', messageId);
  } catch {}
}

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  const mem = inMemoryStore.get(messageId);
  if (mem && mem.status === 'completed') {
    return Date.now() - mem.updatedAt < COMPLETED_TTL_MS;
  }
  return false;
}

export async function markMessageProcessed(
  messageId: string,
  details?: Record<string, unknown>
): Promise<void> {
  await markMessageCompleted(messageId, details);
}

export function clearIdempotencyCache(): void {
  inMemoryStore.clear();
}
