interface WhatsAppMediaMetadataResponse {
  messaging_product?: string;
  url?: string;
  mime_type?: string;
  sha256?: string;
  file_size?: number;
  id?: string;
  error?: {
    message: string;
    type: string;
    code: number;
  };
}

export interface RetrievedAudioMedia {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

/**
 * Retrieves the download URL for a WhatsApp media ID via the WhatsApp Graph API.
 */
export async function getWhatsAppMediaUrl(
  mediaId: string,
  accessToken = process.env.WHATSAPP_ACCESS_TOKEN
): Promise<{ url: string; mimeType: string }> {
  if (!accessToken) {
    throw new Error(
      'WHATSAPP_ACCESS_TOKEN is not configured. Please set it in .env.local to download WhatsApp media.'
    );
  }

  const endpoint = `https://graph.facebook.com/v21.0/${mediaId}`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let isExpiredToken = false;
    try {
      const errObj = JSON.parse(errorText);
      if (errObj?.error?.code === 190) {
        isExpiredToken = true;
      }
    } catch {
      // not JSON
    }

    if (isExpiredToken) {
      throw new Error(
        `WhatsApp Access Token has expired (Meta OAuth Error 190). Meta temporary tokens expire after 24 hours. Please copy a new token from your Meta Dashboard (WhatsApp > API Setup) into WHATSAPP_ACCESS_TOKEN in .env.local.`
      );
    }

    throw new Error(
      `Failed to retrieve WhatsApp media URL (HTTP ${response.status}): ${errorText}`
    );
  }

  const data = (await response.json()) as WhatsAppMediaMetadataResponse;

  if (data.error || !data.url) {
    throw new Error(
      `WhatsApp Graph API error for media ${mediaId}: ${data.error?.message || 'Missing URL'}`
    );
  }

  return {
    url: data.url,
    mimeType: data.mime_type || 'audio/ogg',
  };
}

/**
 * Downloads the binary audio file from the WhatsApp media URL.
 */
export async function downloadWhatsAppAudio(
  mediaUrl: string,
  mimeType: string,
  accessToken = process.env.WHATSAPP_ACCESS_TOKEN
): Promise<RetrievedAudioMedia> {
  if (!accessToken) {
    throw new Error('WHATSAPP_ACCESS_TOKEN is required to download media.');
  }

  const response = await fetch(mediaUrl, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download WhatsApp media binary from storage (HTTP ${response.status})`
    );
  }

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  const extension = mimeType.includes('mp4') || mimeType.includes('m4a')
    ? 'm4a'
    : mimeType.includes('wav')
      ? 'wav'
      : mimeType.includes('mp3') || mimeType.includes('mpeg')
        ? 'mp3'
        : 'ogg';

  return {
    buffer,
    mimeType,
    fileName: `voice-note-${Date.now()}.${extension}`,
  };
}

/**
 * High-level helper to fetch and download WhatsApp audio in one operation.
 */
export async function fetchAndDownloadWhatsAppAudio(
  mediaId: string
): Promise<RetrievedAudioMedia> {
  const { url, mimeType } = await getWhatsAppMediaUrl(mediaId);
  return downloadWhatsAppAudio(url, mimeType);
}
