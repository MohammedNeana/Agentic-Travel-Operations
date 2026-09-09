export interface TranscriptionResult {
  text: string;
  language: string;
}

/**
 * Transcribes Arabic voice notes using Groq's OpenAI-compatible Audio API (`whisper-large-v3`).
 * Base URL: https://api.groq.com/openai/v1
 */
export async function transcribeArabicAudio(
  audioBuffer: Buffer,
  fileName = 'voice_note.ogg',
  mimeType = 'audio/ogg',
  apiKey = process.env.GROQ_API_KEY
): Promise<TranscriptionResult> {
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured in .env.local. Please add your free Groq API key to enable real audio transcription.'
    );
  }

  const blob = new Blob([new Uint8Array(audioBuffer)], { type: mimeType });
  const formData = new FormData();
  formData.append('file', blob, fileName);
  formData.append('model', 'whisper-large-v3');
  formData.append('language', 'ar');
  formData.append(
    'prompt',
    'رسالة صوتية باللغة العربية واللهجة السعودية تتعلق بالرحلات السياحية، الحجوزات، التأخير، أو حالات الطوارئ لشركات إدارة الوجهات السياحية (DMC) في المملكة العربية السعودية.'
  );

  const response = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Groq Whisper API (whisper-large-v3) failed [HTTP ${response.status}]: ${errorText}`
    );
  }

  const result = (await response.json()) as { text?: string };

  if (!result.text || result.text.trim().length === 0) {
    throw new Error('Groq Whisper returned an empty transcription for the voice note.');
  }

  return {
    text: result.text.trim(),
    language: 'ar',
  };
}
