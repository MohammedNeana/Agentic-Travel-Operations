import { z } from 'zod';

/**
 * Zod schema for structured extraction of local Saudi experience provider profiles.
 */
export const ExperienceProviderSchema = z.object({
  name: z
    .string()
    .min(2, 'Name must be at least 2 characters')
    .describe('The commercial or brand name of the Saudi experience provider or tour operator'),
  city: z
    .string()
    .min(2, 'City must be specified')
    .describe(
      'The Saudi city, region, or destination where the experience operates (e.g. AlUla / العُلا, Riyadh / الرياض, Jeddah / جدة, NEOM / نيوم, Diriyah / الدرعية, Taif / الطائف, Abha / أبها)'
    ),
  experience_type: z
    .string()
    .min(2, 'Experience type must be specified')
    .describe(
      'Category of the experience (e.g. Heritage & Culture / تراث وثقافة, Desert Safari / سفاري صحراوي, Culinary Experiences / تجارب طهي, Adventure & Diving / مغامرات وغوص, Photography / تصوير, Stargazing / فلك ونجوم)'
    ),
  capacity: z
    .number()
    .int()
    .positive('Capacity must be a positive integer')
    .describe('Maximum number of guests or travelers accommodated in a single tour, group, or session'),
  verification_status: z
    .enum(['pending', 'verified', 'rejected'])
    .default('pending')
    .describe('Verification status of the provider (defaults to pending for new discoveries)'),
  phone_number: z
    .string()
    .nullable()
    .optional()
    .describe(
      'Direct contact or WhatsApp phone number of the provider with country code (e.g. +9665XXXXXXXX or 05XXXXXXXX), or null if not found'
    ),
});

export type ExtractedExperienceProvider = z.infer<typeof ExperienceProviderSchema>;

/** Groq API response shape */
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
 * Extracts structured experience provider metadata from raw text using
 * Groq's LLM API (llama-3.1-70b-versatile).
 *
 * - Uses response_format: { type: 'json_object' } (Groq's OpenAI-compatible mode).
 * - Validates output with Zod ExperienceProviderSchema.
 * - NO fallback to heuristics or mock data. Fails loudly on error.
 */
export async function extractExperienceProvider(
  textContent: string
): Promise<ExtractedExperienceProvider> {
  if (!textContent || textContent.trim().length === 0) {
    throw new Error('text_content is required and cannot be empty.');
  }

  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured in .env.local. Real AI extraction requires a valid Groq API key. No fallback to fake data.'
    );
  }

  const systemPrompt = `You are a Saudi DMC intelligence agent specializing in extracting structured profiles for local Saudi suppliers and experience providers from scraped web pages, brochures, social media posts, WhatsApp messages, or descriptions.

Extract the details accurately in Arabic or English based on the input. Respond ONLY with valid JSON in this exact structure:
{
  "name": "The commercial or operational name of the provider",
  "city": "The Saudi city or destination (e.g. العُلا, الرياض, جدة, نيوم, الدرعية, الطائف, أبها)",
  "experience_type": "The primary tourist experience category (e.g. تراث وثقافة, سفاري صحراوي, تجارب طهي, مغامرات وغوص, تصوير, فلك ونجوم)",
  "capacity": 12,
  "verification_status": "pending",
  "phone_number": "+9665XXXXXXXX or null"
}

Rules:
- "name": Extract the commercial/brand name. If unclear, derive a descriptive name from context.
- "city": Must be a real Saudi city or region. Infer from context clues if not explicitly stated.
- "experience_type": Categorize the primary experience offered.
- "capacity": Integer for max guest capacity. If unstated, infer a reasonable number (6–20) based on experience type.
- "verification_status": Always "pending" for newly extracted providers.
- "phone_number": Extract contact/WhatsApp number with country code. Return null if not mentioned.`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'llama-3.1-70b-versatile',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract the experience provider profile from this text:\n\n"${textContent}"` },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.1,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `Groq extraction API failed [HTTP ${response.status}]: ${errorText}`
    );
  }

  const data = (await response.json()) as GroqChatCompletionResponse;
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('Groq LLM returned an empty response. No extraction possible.');
  }

  // Handle potential markdown code fences: ```json ... ```
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsedJson = JSON.parse(cleaned);

  // Validate with Zod schema — strict type safety
  const validated = ExperienceProviderSchema.parse(parsedJson);

  console.log('[Groq Extraction] ✅ Successfully extracted provider:', {
    name: validated.name,
    city: validated.city,
    type: validated.experience_type,
    capacity: validated.capacity,
    phone: validated.phone_number ?? 'N/A',
  });

  return validated;
}
