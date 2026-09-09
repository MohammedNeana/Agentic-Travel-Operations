import type { IntentCategory, IntentClassificationResult } from './types';

interface GroqChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
    type?: string;
    code?: string;
  };
}

/**
 * Classifies transcribed voice note intent using Groq's OpenAI-compatible Chat API
 * running `llama-3.1-70b-versatile`.
 * Base URL: https://api.groq.com/openai/v1
 */
export async function classifyVoiceIntent(
  transcriptionText: string,
  apiKey = process.env.GROQ_API_KEY,
  model = process.env.GROQ_LLM_MODEL || 'llama-3.1-70b-versatile'
): Promise<IntentClassificationResult> {
  if (!transcriptionText || transcriptionText.trim().length === 0) {
    throw new Error('Cannot classify intent: Transcribed voice note text is empty.');
  }

  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured in .env.local. Please add your free Groq API key to enable real LLM intent classification.'
    );
  }

  const systemPrompt = `You are an AI Incident Dispatcher for a Saudi Destination Management Company (DMC) receiving WhatsApp voice messages from tour guides, drivers, and travelers.
Classify the intent into strictly one of these categories:
- "Delay": Travel delays, traffic jams, vehicle breakdowns, schedule postponements.
- "Emergency": Medical issues, injuries, lost persons, security or safety incidents.
- "General": Casual queries, positive feedback, meal preferences, or routine questions.

Respond ONLY with valid JSON in this exact structure:
{
  "category": "Delay" | "Emergency" | "General",
  "confidence": 0.95,
  "reason": "Brief explanation in Arabic of why this category was chosen",
  "suggestedAction": "Suggested action in Arabic for the DMC operations dashboard"
}`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Transcribed Arabic Voice Message:\n"${transcriptionText}"` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Groq Chat Completion API (${model}) failed [HTTP ${response.status}]: ${errorText}`
    );
  }

  const data = (await response.json()) as GroqChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Groq LLM returned an empty response content.');
  }

  const parsed = JSON.parse(content) as {
    category?: string;
    confidence?: number;
    reason?: string;
    suggestedAction?: string;
  };

  let category: IntentCategory = 'General';
  if (parsed.category === 'Emergency') category = 'Emergency';
  else if (parsed.category === 'Delay') category = 'Delay';

  const isEscalationRequired = category === 'Emergency' || category === 'Delay';

  return {
    category,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
    reason: parsed.reason || '',
    suggestedAction: parsed.suggestedAction || '',
    isEscalationRequired,
  };
}
