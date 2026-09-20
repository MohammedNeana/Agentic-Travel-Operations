interface CachedMessageRecord {
  messageId: string;
  processedAt: number;
  details?: Record<string, unknown>;
}

const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const processedMessageMap = new Map<string, CachedMessageRecord>();

export async function isMessageProcessed(messageId: string): Promise<boolean> {
  if (!messageId || typeof messageId !== 'string') {
    return false;
  }

  const cached = processedMessageMap.get(messageId);
  if (cached) {
    const now = Date.now();
    if (now - cached.processedAt < IDEMPOTENCY_TTL_MS) {
      return true;
    }
    processedMessageMap.delete(messageId);
  }

  return false;
}

export async function markMessageProcessed(
  messageId: string,
  details?: Record<string, unknown>
): Promise<void> {
  if (!messageId || typeof messageId !== 'string') {
    return;
  }

  const now = Date.now();
  processedMessageMap.set(messageId, {
    messageId,
    processedAt: now,
    details,
  });

  if (processedMessageMap.size > 10000) {
    for (const [id, rec] of processedMessageMap.entries()) {
      if (now - rec.processedAt > IDEMPOTENCY_TTL_MS) {
        processedMessageMap.delete(id);
      }
    }
  }
}

export function clearIdempotencyCache(): void {
  processedMessageMap.clear();
}
