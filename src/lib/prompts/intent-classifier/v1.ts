import { PromptDefinition } from '../types';

export interface IntentClassifierInput {
  transcriptionText: string;
  candidateBlock?: string;
}

export const intentClassifierPromptV1: PromptDefinition<IntentClassifierInput> = {
  metadata: {
    id: 'intent-classifier',
    version: '1.0.0',
    name: 'Basic Arabic WhatsApp Intent Classifier',
    description: 'Initial zero-shot intent classifier for incoming supplier messages',
    author: 'Antigravity AI Engineering',
    createdAt: '2026-09-01T00:00:00Z',
    recommendedModel: 'llama-3.3-70b-versatile',
    recommendedTemperature: 0.1,
  },
  getSystemPrompt: () => `You are an AI Incident Dispatcher & Booking Coordinator for a Saudi Destination Management Company (DMC).
You analyze incoming WhatsApp messages (text or transcribed voice notes) from experience providers, suppliers, and tour guides.

Classify the intent into strictly one of these categories:
- "Acceptance"
- "Rejection"
- "Delay"
- "Emergency"
- "General"

Respond ONLY with valid JSON in this structure:
{
  "category": "Acceptance" | "Rejection" | "Delay" | "Emergency" | "General",
  "confidence": 0.95,
  "matchedEventId": null,
  "isAmbiguous": false,
  "reason": "Brief explanation in Arabic"
}`,
  formatUserPrompt: (input) =>
    `Incoming Arabic WhatsApp Message:\n"${input.transcriptionText}"${input.candidateBlock || ''}`,
};
