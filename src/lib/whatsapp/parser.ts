import crypto from 'crypto';
import type {
  WhatsAppWebhookPayload,
  ParsedMessageContext,
  ParsedButtonAction,
  ParsedAudioMessage,
} from './types';

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

export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret = process.env.WHATSAPP_APP_SECRET
): boolean {
  if (!appSecret || appSecret === 'your_whatsapp_app_secret_here' || appSecret.trim() === '') {
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
  } catch {
    return false;
  }
}

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

        if (msg.type === 'interactive' && msg.interactive) {
          const btnReply = msg.interactive.button_reply;
          const listReply = msg.interactive.list_reply;
          const replyId = btnReply?.id || listReply?.id || '';
          const replyTitle = btnReply?.title || listReply?.title || '';

          const acceptMatch = replyId.match(/^accept_booking[_-](.+)$/i);
          if (acceptMatch && acceptMatch[1]) {
            action = {
              type: 'accept_booking',
              eventId: acceptMatch[1].trim(),
              rawButtonId: replyId,
              buttonTitle: replyTitle,
            };
          }

          const rejectMatch = replyId.match(/^reject_booking[_-](.+)$/i);
          if (rejectMatch && rejectMatch[1]) {
            action = {
              type: 'reject_booking',
              eventId: rejectMatch[1].trim(),
              rawButtonId: replyId,
              buttonTitle: replyTitle,
            };
          }
        }

        if (msg.type === 'audio' && msg.audio) {
          audio = {
            type: 'audio',
            mediaId: msg.audio.id,
            mimeType: msg.audio.mime_type || 'audio/ogg',
            isVoiceNote: Boolean(msg.audio.voice),
          };
        }

        const textBody = msg.text?.body ? msg.text.body.trim() : undefined;

        parsedMessages.push({
          messageId: msg.id,
          fromPhoneNumber: msg.from,
          contactName,
          timestamp: msg.timestamp,
          rawType: msg.type,
          textBody,
          action,
          audio,
        });
      }
    }
  }

  return parsedMessages;
}
