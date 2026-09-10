import type { ProviderNotificationDetails, OutboundNotificationResult } from './types';

/**
 * Normalizes phone numbers for Meta WhatsApp Cloud API:
 * Strips non-digits, leading +, spaces, dashes, and leading '00'.
 */
export function cleanPhoneNumber(phone: string): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '').replace(/^00/, '');
}

/**
 * Formats the Arabic booking notification message body for an experience provider.
 */
export function formatBookingNotificationText(details: ProviderNotificationDetails): string {
  const title = details.title || 'تجربة سياحية';
  const date = details.date || 'تاريخ محدد';
  const time = details.time ? ` في تمام الساعة [${details.time}]` : '';
  const group = details.groupSize ? ` | عدد الضيوف: ${details.groupSize}` : '';

  return `لديك طلب حجز جديد لفعالية [${title}] بتاريخ [${date}]${time}${group}. يرجى التأكيد.`;
}

/**
 * Resolves the target recipient phone number, falling back to the developer
 * verified test recipient phone configured in environment variables.
 */
export function resolveRecipientPhone(providerPhone?: string | null): { phone: string; isRealProvider: boolean } {
  const cleaned = cleanPhoneNumber(providerPhone || '');
  if (cleaned && cleaned.length >= 8) {
    return { phone: cleaned, isRealProvider: true };
  }

  const fallback = cleanPhoneNumber(process.env.WHATSAPP_TEST_RECIPIENT_PHONE || '');
  return { phone: fallback, isRealProvider: false };
}

/**
 * Sends an outbound WhatsApp notification to an experience provider
 * via Meta Graph API v17.0.
 *
 * Supports interactive confirmation buttons (linking to accept_booking_{id}),
 * text messages, and automated fallbacks.
 */
export async function sendProviderNotification(
  providerPhone: string,
  eventDetails: ProviderNotificationDetails
): Promise<OutboundNotificationResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v17.0';

  if (!accessToken) {
    const errorMsg = 'WHATSAPP_ACCESS_TOKEN is missing in environment variables.';
    console.error(`[WhatsApp Outbound] ❌ ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  if (!phoneNumberId) {
    const errorMsg =
      'WHATSAPP_PHONE_NUMBER_ID is not configured in .env.local. Please add your Meta Phone Number ID.';
    console.error(`[WhatsApp Outbound] ❌ ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  const { phone: recipientPhone, isRealProvider } = resolveRecipientPhone(providerPhone);
  if (!recipientPhone) {
    const errorMsg =
      'No valid recipient phone number found. Neither provider phone nor WHATSAPP_TEST_RECIPIENT_PHONE is configured.';
    console.error(`[WhatsApp Outbound] ❌ ${errorMsg}`);
    return { success: false, error: errorMsg };
  }

  if (isRealProvider) {
    console.log(
      `[WhatsApp Outbound] 📱 Using real provider phone number from database: ${recipientPhone}`
    );
  } else {
    console.log(
      `[WhatsApp Outbound] 🧪 Provider lacks real phone in database. Using developer test recipient phone: ${recipientPhone}`
    );
  }

  const messageText = formatBookingNotificationText(eventDetails);
  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  console.log(
    `[WhatsApp Outbound] 📤 Initiating outbound booking notification to ${recipientPhone} for "${eventDetails.title}"...`
  );

  // Strategy A: Interactive Button Message (allows 1-tap confirmation from provider)
  if (eventDetails.id) {
    try {
      const interactivePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: {
            text: messageText,
          },
          action: {
            buttons: [
              {
                type: 'reply',
                reply: {
                  id: `accept_booking_${eventDetails.id}`,
                  title: 'تأكيد الحجز ✅',
                },
              },
            ],
          },
        },
      };

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(interactivePayload),
      });

      const data = await response.json();

      if (response.ok && data?.messages?.[0]?.id) {
        const msgId = data.messages[0].id;
        console.log(
          `[WhatsApp Outbound] ✅ Interactive button message sent successfully! Message ID: ${msgId}`
        );
        return {
          success: true,
          messageId: msgId,
          recipientPhone,
          mode: 'interactive',
        };
      }

      console.warn(
        `[WhatsApp Outbound] ⚠️ Interactive message rejected (${data?.error?.message || response.status}). Retrying with simple text message...`
      );
    } catch (interactiveErr) {
      console.warn(
        '[WhatsApp Outbound] ⚠️ Interactive send threw exception. Falling back to plain text:',
        interactiveErr
      );
    }
  }

  // Strategy B: Standard Text Message
  try {
    const textPayload = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipientPhone,
      type: 'text',
      text: {
        preview_url: false,
        body: messageText,
      },
    };

    const textResponse = await fetch(endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(textPayload),
    });

    const textData = await textResponse.json();

    if (textResponse.ok && textData?.messages?.[0]?.id) {
      const msgId = textData.messages[0].id;
      console.log(
        `[WhatsApp Outbound] ✅ Text message sent successfully! Message ID: ${msgId}`
      );
      return {
        success: true,
        messageId: msgId,
        recipientPhone,
        mode: 'text',
      };
    }

    // Check if failure is due to 24h customer service window (Meta error 131047)
    const errorCode = textData?.error?.code;
    const errorMsg = textData?.error?.message || `HTTP ${textResponse.status}`;

    if (errorCode === 131047) {
      console.warn(
        '[WhatsApp Outbound] ⚠️ Recipient outside 24-hour customer service window (code 131047). Attempting hello_world template fallback...'
      );

      // Strategy C: Template fallback (allowed outside 24h window)
      const templatePayload = {
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: recipientPhone,
        type: 'template',
        template: {
          name: 'hello_world',
          language: {
            code: 'en_US',
          },
        },
      };

      const tplResponse = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(templatePayload),
      });

      const tplData = await tplResponse.json();
      if (tplResponse.ok && tplData?.messages?.[0]?.id) {
        console.log(
          `[WhatsApp Outbound] ✅ Template message sent successfully outside 24h window! Message ID: ${tplData.messages[0].id}`
        );
        return {
          success: true,
          messageId: tplData.messages[0].id,
          recipientPhone,
          mode: 'template',
        };
      }
    }

    console.error(`[WhatsApp Outbound] ❌ Meta Graph API failed: ${errorMsg}`, textData);
    return {
      success: false,
      recipientPhone,
      error: errorMsg,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error';
    console.error('[WhatsApp Outbound] ❌ Network/runtime error while sending WhatsApp message:', error);
    return {
      success: false,
      recipientPhone,
      error: message,
    };
  }
}
