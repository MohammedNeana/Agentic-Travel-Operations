export interface AudioPayload {
  buffer: Buffer;
  fileName?: string;
  mimeType?: string;
}

export interface TranscriptionResponse {
  text: string;
  language?: string;
  duration?: number;
}

export interface SpeechToTextService {
  transcribe(payload: AudioPayload): Promise<TranscriptionResponse>;
}
