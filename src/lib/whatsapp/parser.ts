import crypto from 'crypto';
import type {
  WhatsAppWebhookPayload,
  ParsedMessageContext,
  ParsedButtonAction,
  ParsedAudioMessage,
} from './types';

/**
 * Validates the WhatsApp GET webhook verification handshake.
 * When configuring the webhook in the Meta Developer Portal, Meta sends:
 * - hub.mode ('subscribe')
 * - hub.verify_token (configured secret token)
 * - hub.challenge (string to echo back with HTTP 200)
 */
export function validateVerificationChallenge(
  searchParams: URLSearchParams,
  configuredVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN
): { isValid: boolean; challenge: string | null } {
  const mode = searchParams.get('hub.mode');
  const token = searchParams.get('hub.verify_token');
  const challenge = searchParams.get('hub.challenge');

  if (mode === 'subscribe' && token && challenge) {
    if (!configuredVerifyToken || token === configuredVerifyToken) {
      return { isValid: true, challenge };
    }
  }

  return { isValid: false, challenge: null };
}

/**
 * Validates WhatsApp X-Hub-Signature-256 header using HMAC-SHA256.
 * Returns true if valid or if no secret is configured (dev/demo mode).
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret = process.env.WHATSAPP_APP_SECRET
): boolean {
  if (!appSecret) {
    // If no secret configured in environment, skip signature verification in dev
    return true;
  }

  if (!signatureHeader) {
    return false;
  }

  const [algorithm, hash] = signatureHeader.split('=');
  if (algorithm !== 'sha256' || !hash) {
    return false;
  }

  try {
    const expectedHash = crypto
      .createHmac('sha256', appSecret)
      .update(rawBody, 'utf8')
      .digest('hex');

    return crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(expectedHash, 'hex')
    );
  } catch (error) {
    console.error('Signature verification error:', error);
    return false;
  }
}

/**
 * Extracts and normalizes incoming messages from WhatsApp Cloud API webhook payload.
 */
export function extractWhatsAppMessages(
  payload: WhatsAppWebhookPayload
): ParsedMessageContext[] {
  const parsedMessages: ParsedMessageContext[] = [];

  if (!payload || !Array.isArray(payload.entry)) {
    return parsedMessages;
  }

  for (const entry of payload.entry) {
    for (const change of entry.changes || []) {
      const value = change.value;
      if (!value || value.messaging_product !== 'whatsapp') continue;

      const contactsMap = new Map<string, string>();
      for (const contact of value.contacts || []) {
        if (contact.profile?.name) {
          contactsMap.set(contact.wa_id, contact.profile.name);
        }
      }

      for (const msg of value.messages || []) {
        const contactName = contactsMap.get(msg.from);

        let action: ParsedButtonAction | undefined;
        let audio: ParsedAudioMessage | undefined;

        // 1. Interactive Button Reply
        if (msg.type === 'interactive' && msg.interactive) {
          const btnReply = msg.interactive.button_reply;
          const listReply = msg.interactive.list_reply;
          const replyId = btnReply?.id || listReply?.id || '';
          const replyTitle = btnReply?.title || listReply?.title || '';

          const match = replyId.match(/^accept_booking[_-](.+)$/i);
          if (match && match[1]) {
            action = {
              type: 'accept_booking',
              eventId: match[1].trim(),
              rawButtonId: replyId,
              buttonTitle: replyTitle,
            };
          }
        }

        // 2. Audio Message
        if (msg.type === 'audio' && msg.audio) {
          audio = {
            type: 'audio',
            mediaId: msg.audio.id,
            mimeType: msg.audio.mime_type || 'audio/ogg',
            isVoiceNote: Boolean(msg.audio.voice),
          };
        }

        parsedMessages.push({
          messageId: msg.id,
          fromPhoneNumber: msg.from,
          contactName,
          timestamp: msg.timestamp,
          rawType: msg.type,
          action,
          audio,
        });
      }
    }
  }

  return parsedMessages;
}
