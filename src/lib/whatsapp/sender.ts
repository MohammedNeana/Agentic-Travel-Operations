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
  const title = details.title || 'التجربة السياحية';
  const date = details.date || 'الموعد المحدد';
  const timeInfo = details.time
    ? details.endTime
      ? `من الساعة ${details.time} إلى ${details.endTime}`
      : `الساعة ${details.time}`
    : 'خلال اليوم';

  const nationalityText = details.groupNationality ? `وفد سياحي (${details.groupNationality})` : 'وفد سياحي';
  const groupText = details.groupSize ? `عددهم ${details.groupSize} أشخاص` : '';
  const groupDetails = [nationalityText, groupText].filter(Boolean).join(' ');

  const dietary = details.dietaryRestrictions && details.dietaryRestrictions.length > 0
    ? `\n🥗 القيود الغذائية: ${details.dietaryRestrictions.join('، ')}`
    : '';

  const mobility = details.mobilityNotes && details.mobilityNotes.trim().length > 0
    ? `\n♿ ملاحظة التنقل: ${details.mobilityNotes.trim()}`
    : '';

  const extraNotes = details.notes && details.notes.trim().length > 0
    ? `\n📝 ملاحظات إضافية: ${details.notes.trim()}`
    : '';

  return `السلام عليكم ورحمة الله، حياك الله أخوي الكريم 👋

معك منسق العمليات في There DMC.
حابين ننسق معكم لحجز تجربة "${title}" لـ ${groupDetails}.

🗓️ التاريخ: ${date}
⏰ الوقت: ${timeInfo}${dietary}${mobility}${extraNotes}

الله يسعدك ودنا نتأكد من جاهزيتكم وإمكانية استقبال الوفد وملاءمة هذه المتطلبات؟ 

شاكرين ومقدرين تعاونكم الدائم 🙏`;
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
/**
 * Sends a natural human-like text message directly to a WhatsApp recipient
 * via Meta Graph API v17.0.
 * Used for dynamic LLM clarifications, follow-ups, and natural chat continuity.
 */
export async function sendWhatsAppTextMessage(
  providerPhone: string,
  messageText: string
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

  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

  console.log(
    `[WhatsApp Outbound] 📤 Dispatching natural human-like message to ${recipientPhone}...`
  );

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
        `[WhatsApp Outbound] ✅ Human-like text message sent successfully! Message ID: ${msgId}`
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

/**
 * Sends an outbound WhatsApp booking notification to an experience provider.
 */
export async function sendProviderNotification(
  providerPhone: string,
  eventDetails: ProviderNotificationDetails
): Promise<OutboundNotificationResult> {
  const messageText = formatBookingNotificationText(eventDetails);
  return sendWhatsAppTextMessage(providerPhone, messageText);
}
