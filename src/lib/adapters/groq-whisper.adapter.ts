import { SpeechToTextService, AudioPayload, TranscriptionResponse } from '../ports/speech.port';
import { transcribeArabicAudio } from '../whatsapp/transcription';

export class GroqWhisperAdapter implements SpeechToTextService {
  async transcribe(payload: AudioPayload): Promise<TranscriptionResponse> {
    const result = await transcribeArabicAudio(
      payload.buffer,
      payload.fileName || 'voice_note.ogg',
      payload.mimeType || 'audio/ogg'
    );
    return {
      text: result.text,
      language: result.language,
    };
  }
}
