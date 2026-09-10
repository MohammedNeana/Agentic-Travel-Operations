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

/**
 * Local heuristic extractor used when OpenAI API key is unavailable.
 */
function heuristicExtract(text: string): ExtractedExperienceProvider {
  // Extract potential capacity
  const capacityMatch =
    text.match(/(?:سعة|تتسع|يستوعب|تستوعب|لـ|حتى|بحد أقصى|سعتها|capacity(?:\s*of)?)\s*[:：]?\s*(\d{1,4})/i) ||
    text.match(/(\d{1,3})\s*(?:شخص|أشخاص|ضيوف|ضيف|زائر|ركاب|guests|people|persons|pax)/i);
  const capacity = capacityMatch ? parseInt(capacityMatch[1], 10) : 12;

  // City detection in Saudi Arabia
  const cities: Record<string, string> = {
    العلا: 'العُلا',
    العُلا: 'العُلا',
    alula: 'العُلا',
    الرياض: 'الرياض',
    riyadh: 'الرياض',
    جدة: 'جدة',
    jeddah: 'جدة',
    نيوم: 'نيوم',
    neom: 'نيوم',
    الدرعية: 'الرياض',
    diriyah: 'الرياض',
    الطائف: 'الطائف',
    taif: 'الطائف',
    أبها: 'أبها',
    abha: 'أبها',
    عسير: 'عسير',
    tabuk: 'تبوك',
    تبوك: 'تبوك',
    ينبع: 'ينبع',
    yanbu: 'ينبع',
  };

  let detectedCity = 'الرياض';
  const lowerText = text.toLowerCase();
  for (const [kw, city] of Object.entries(cities)) {
    if (lowerText.includes(kw)) {
      detectedCity = city;
      break;
    }
  }

  // Experience Type detection
  let detectedType = 'تراث وثقافة';
  if (/غوص|بحر|diving|sea|marine/i.test(text)) {
    detectedType = 'مغامرات بحرية وغوص';
  } else if (/سفاري|صحراء|مخيم|dune|desert|safari/i.test(text)) {
    detectedType = 'سفاري صحراوي';
  } else if (/طهي|طعام|أكل|طبخ|culinary|food|cooking/i.test(text)) {
    detectedType = 'تجارب طهي وتذوق';
  } else if (/تصوير|كاميرا|photography|photo/i.test(text)) {
    detectedType = 'جولات تصوير فوتوغرافي';
  } else if (/نجوم|فلك|stargazing|astronomy/i.test(text)) {
    detectedType = 'رصد الفلك والنجوم';
  }

  // Phone number extraction (WhatsApp / Mobile)
  let detectedPhone: string | null = null;
  const keywordMatch = text.match(
    /(?:واتساب|واتس|جوال|هاتف|تواصل|اتصال|رقم|موبايل|phone|whatsapp|mobile|tel)\s*[:：\-]?\s*(\+?[\d\s\-\(\)]{9,20})/i
  );
  if (keywordMatch && keywordMatch[1]) {
    const cleaned = keywordMatch[1].replace(/[^\d+]/g, '');
    if (cleaned.length >= 9 && cleaned.length <= 16) {
      detectedPhone = cleaned;
    }
  }

  if (!detectedPhone) {
    const saudiMatch = text.match(/(?:\+?966|00966|0)?5\d{8}\b/);
    if (saudiMatch && saudiMatch[0]) {
      let num = saudiMatch[0].replace(/[^\d+]/g, '');
      if (num.startsWith('05')) {
        num = '+966' + num.slice(1);
      } else if (num.startsWith('5')) {
        num = '+966' + num;
      } else if (num.startsWith('966')) {
        num = '+' + num;
      }
      detectedPhone = num;
    }
  }

  // Name extraction (first line or quoted or first words)
  const lines = text.split(/[\n.]/).map((l) => l.trim()).filter(Boolean);
  let name = lines[0] || 'مزود تجربة سياحية سعودي';
  if (name.length > 50) {
    name = name.substring(0, 47) + '...';
  }

  return {
    name,
    city: detectedCity,
    experience_type: detectedType,
    capacity,
    verification_status: 'pending',
    phone_number: detectedPhone,
  };
}

/**
 * Extracts structured experience provider metadata from raw text using OpenAI Structured Outputs.
 */
export async function extractExperienceProvider(
  textContent: string,
  apiKey = process.env.OPENAI_API_KEY
): Promise<ExtractedExperienceProvider> {
  if (!textContent || textContent.trim().length === 0) {
    throw new Error('text_content is required and cannot be empty.');
  }

  if (!apiKey) {
    console.warn(
      'OPENAI_API_KEY is not configured in environment. Using intelligent local heuristic extraction.'
    );
    return heuristicExtract(textContent);
  }

  const systemPrompt = `You are a Saudi DMC intelligence agent specializing in extracting structured profiles for local Saudi suppliers and experience providers from scraped web pages, brochures, or descriptions.
Extract the details accurately in Arabic or English based on the input:
- name: The commercial or operational name of the provider.
- city: The Saudi city or destination (e.g. AlUla / العُلا, Riyadh / الرياض, Jeddah / جدة, NEOM / نيوم, Diriyah / الدرعية, etc.).
- experience_type: The primary tourist experience category.
- capacity: An integer representing the maximum guest capacity. If unstated, infer a reasonable capacity between 6 and 20 based on the experience type.
- verification_status: Always set to "pending" for newly extracted providers.
- phone_number: The contact or WhatsApp mobile number (e.g. +9665XXXXXXXX, 05XXXXXXXX). If not mentioned, return null.`;

  const jsonSchema = {
    name: 'experience_provider',
    strict: true,
    schema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: 'Name of the provider or tour company',
        },
        city: {
          type: 'string',
          description: 'Saudi city or region of operation',
        },
        experience_type: {
          type: 'string',
          description: 'Category of the experience offered',
        },
        capacity: {
          type: 'number',
          description: 'Maximum guest capacity as an integer number',
        },
        verification_status: {
          type: 'string',
          enum: ['pending', 'verified', 'rejected'],
          description: 'Initial verification status, default pending',
        },
        phone_number: {
          type: ['string', 'null'],
          description:
            'Contact or WhatsApp mobile phone number of the provider, or null if not found in text',
        },
      },
      required: [
        'name',
        'city',
        'experience_type',
        'capacity',
        'verification_status',
        'phone_number',
      ],
      additionalProperties: false,
    },
  };

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: textContent },
        ],
        response_format: {
          type: 'json_schema',
          json_schema: jsonSchema,
        },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `OpenAI structured extraction failed (${response.status}): ${errorText}. Falling back to heuristic extractor.`
      );
      return heuristicExtract(textContent);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return heuristicExtract(textContent);
    }

    const parsedJson = JSON.parse(content);
    // Validate with Zod schema
    return ExperienceProviderSchema.parse(parsedJson);
  } catch (error) {
    console.error('Error during OpenAI structured extraction, falling back to heuristic:', error);
    return heuristicExtract(textContent);
  }
}
