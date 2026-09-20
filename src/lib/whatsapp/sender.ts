import type { ProviderNotificationDetails, OutboundNotificationResult } from './types';

export function cleanPhoneNumber(phone: string): string {
  if (!phone) return '';
  return phone.replace(/[^\d]/g, '').replace(/^00/, '');
}

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
    ? `\nالقيود الغذائية: ${details.dietaryRestrictions.join('، ')}`
    : '';

  const mobility = details.mobilityNotes && details.mobilityNotes.trim().length > 0
    ? `\nملاحظة التنقل: ${details.mobilityNotes.trim()}`
    : '';

  const extraNotes = details.notes && details.notes.trim().length > 0
    ? `\nملاحظات إضافية: ${details.notes.trim()}`
    : '';

  return `السلام عليكم ورحمة الله، حياك الله أخي الكريم

معك منسق العمليات في There DMC.
حابين ننسق معكم لحجز تجربة "${title}" لـ ${groupDetails}.

التاريخ: ${date}
الوقت: ${timeInfo}${dietary}${mobility}${extraNotes}

ودنا نتأكد من جاهزيتكم وإمكانية استقبال الوفد وملاءمة هذه المتطلبات؟

شاكرين ومقدرين تعاونكم الدائم`;
}

export function resolveRecipientPhone(providerPhone?: string | null): { phone: string; isRealProvider: boolean } {
  const cleaned = cleanPhoneNumber(providerPhone || '');
  if (cleaned && cleaned.length >= 8) {
    return { phone: cleaned, isRealProvider: true };
  }

  const fallback = cleanPhoneNumber(process.env.WHATSAPP_TEST_RECIPIENT_PHONE || '');
  return { phone: fallback, isRealProvider: false };
}

export async function sendWhatsAppTextMessage(
  providerPhone: string,
  messageText: string
): Promise<OutboundNotificationResult> {
  const accessToken = process.env.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const apiVersion = process.env.WHATSAPP_GRAPH_API_VERSION || 'v21.0';

  if (!accessToken) {
    return { success: false, error: 'WHATSAPP_ACCESS_TOKEN is missing in environment variables.' };
  }

  if (!phoneNumberId) {
    return { success: false, error: 'WHATSAPP_PHONE_NUMBER_ID is not configured in .env.local.' };
  }

  const { phone: recipientPhone } = resolveRecipientPhone(providerPhone);
  if (!recipientPhone) {
    return { success: false, error: 'No valid recipient phone number found.' };
  }

  const endpoint = `https://graph.facebook.com/${apiVersion}/${phoneNumberId}/messages`;

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
      return {
        success: true,
        messageId: msgId,
        recipientPhone,
        mode: 'text',
      };
    }

    const errorCode = textData?.error?.code;
    const errorMsg = textData?.error?.message || `HTTP ${textResponse.status}`;

    if (errorCode === 131047) {
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
        return {
          success: true,
          messageId: tplData.messages[0].id,
          recipientPhone,
          mode: 'template',
        };
      }
    }

    return {
      success: false,
      recipientPhone,
      error: errorMsg,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error';
    return {
      success: false,
      recipientPhone,
      error: message,
    };
  }
}

export async function sendProviderNotification(
  providerPhone: string,
  eventDetails: ProviderNotificationDetails
): Promise<OutboundNotificationResult> {
  const messageText = formatBookingNotificationText(eventDetails);
  return sendWhatsAppTextMessage(providerPhone, messageText);
}
