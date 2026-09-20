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
 * Classifies transcribed voice note intent using Groq's OpenAI-compatible Chat API.
 * Uses Groq's active production models (openai/gpt-oss-120b, openai/gpt-oss-20b, qwen/qwen3.6-27b).
 * Base URL: https://api.groq.com/openai/v1
 */
export async function classifyVoiceIntent(
  transcriptionText: string,
  apiKey = process.env.GROQ_API_KEY,
  model = process.env.GROQ_LLM_MODEL || 'openai/gpt-oss-120b'
): Promise<IntentClassificationResult> {
  if (!transcriptionText || transcriptionText.trim().length === 0) {
    throw new Error('Cannot classify intent: Transcribed voice note text is empty.');
  }

  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured in .env.local. Please add your free Groq API key to enable real LLM intent classification.'
    );
  }

  const systemPrompt = `You are an AI Incident Dispatcher & Booking Coordinator for a Saudi Destination Management Company (DMC) receiving WhatsApp messages (text or transcribed voice notes) from experience providers, suppliers, drivers, and tour guides.
Classify the intent into strictly one of these categories:
- "Acceptance": The supplier confirms, accepts, or agrees to the booking request (e.g., "تم التأكيد", "نؤكد الحجز", "جاهزون للاستقبال", "نعم متاحين", "أهلاً وسهلاً").
- "Rejection": The supplier declines, rejects, apologizes, or states they are unavailable or fully booked (e.g., "نعتذر", "غير متاحين", "المكان محجوز بالكامل", "لا يمكننا الاستقبال").
- "Delay": Travel delays, traffic jams, vehicle breakdowns, or requests to postpone the start time.
- "Emergency": Medical issues, injuries, lost persons, security or safety incidents.
- "General": Casual queries, routine questions, or greetings.

Respond ONLY with valid JSON in this exact structure:
{
  "category": "Acceptance" | "Rejection" | "Delay" | "Emergency" | "General",
  "confidence": 0.95,
  "reason": "Brief explanation in Arabic of why this category was chosen",
  "suggestedAction": "Suggested action in Arabic for the DMC operations dashboard"
}`;

  // Candidate models to try in sequence if a specific model was deprecated or not accessible on this key
  const candidateModels = process.env.GROQ_LLM_MODEL
    ? [process.env.GROQ_LLM_MODEL]
    : [model, 'openai/gpt-oss-20b', 'qwen/qwen3.6-27b'];

  let lastError: Error | null = null;

  for (const currentModel of candidateModels) {
    try {
      const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: currentModel,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: `Incoming Arabic WhatsApp Message (Text or Transcribed Audio):\n"${transcriptionText}"` },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        const err = new Error(
          `Groq Chat Completion API (${currentModel}) failed [HTTP ${response.status}]: ${errorText}`
        );
        // If it's a 404 / model deprecated error, try the next model candidate
        if (response.status === 404 || response.status === 400) {
          lastError = err;
          console.warn(`Groq model ${currentModel} returned HTTP ${response.status}, trying next available model...`);
          continue;
        }
        throw err;
      }

      const data = (await response.json()) as GroqChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(`Groq LLM (${currentModel}) returned an empty response content.`);
      }

      // Handle potential markdown code fences: ```json ... ```
      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as {
        category?: string;
        confidence?: number;
        reason?: string;
        suggestedAction?: string;
      };

      let category: IntentCategory = 'General';
      if (parsed.category === 'Acceptance') category = 'Acceptance';
      else if (parsed.category === 'Rejection') category = 'Rejection';
      else if (parsed.category === 'Emergency') category = 'Emergency';
      else if (parsed.category === 'Delay') category = 'Delay';

      const isEscalationRequired = category === 'Emergency' || category === 'Delay';

      console.log(`[Groq Intent] Successfully classified WhatsApp message with ${currentModel}:`, {
        category,
        isEscalationRequired,
        reason: parsed.reason,
      });

      return {
        category,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
        reason: parsed.reason || '',
        suggestedAction: parsed.suggestedAction || '',
        isEscalationRequired,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      // If it's not a model error, propagate immediately
      if (!lastError.message.includes('HTTP 404') && !lastError.message.includes('HTTP 400')) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('Failed to classify WhatsApp message intent with available Groq models.');
}

/**
 * Alias for classifying any WhatsApp message (text body or transcribed audio).
 */
export const classifyWhatsAppMessageIntent = classifyVoiceIntent;
