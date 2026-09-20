import { describe, it, expect, beforeEach } from 'vitest';
import {
  isMessageProcessed,
  markMessageProcessed,
  clearIdempotencyCache,
} from '@/lib/whatsapp/idempotency';

describe('WhatsApp Webhook Idempotency Layer', () => {
  beforeEach(() => {
    clearIdempotencyCache();
  });

  it('reports unobserved message IDs as not processed', async () => {
    const isSeen = await isMessageProcessed('wamid_test_1001');
    expect(isSeen).toBe(false);
  });

  it('marks and detects processed message IDs correctly', async () => {
    const msgId = 'wamid_test_2002';
    expect(await isMessageProcessed(msgId)).toBe(false);

    await markMessageProcessed(msgId, { test: true });
    expect(await isMessageProcessed(msgId)).toBe(true);
  });

  it('treats different message IDs independently', async () => {
    const msg1 = 'wamid_first_001';
    const msg2 = 'wamid_second_002';

    await markMessageProcessed(msg1);
    expect(await isMessageProcessed(msg1)).toBe(true);
    expect(await isMessageProcessed(msg2)).toBe(false);
  });

  it('clears cache on reset', async () => {
    const msgId = 'wamid_to_clear';
    await markMessageProcessed(msgId);
    expect(await isMessageProcessed(msgId)).toBe(true);

    clearIdempotencyCache();
    expect(await isMessageProcessed(msgId)).toBe(false);
  });
});
