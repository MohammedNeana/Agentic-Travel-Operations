import type { IntentCategory, IntentClassificationResult } from './types';

interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message: string;
  };
}

/**
 * Heuristic fallback classifier when OpenAI API key is not present.
 */
function heuristicClassify(text: string): IntentClassificationResult {
  const normalized = text.toLowerCase();

  const emergencyKeywords = [
    'طوارئ',
    'حادث',
    'إسعاف',
    'مستشفى',
    'خطر',
    'مساعدة فورية',
    'عالق',
    'إصابة',
    'ضياع',
    'emergency',
    'accident',
    'hospital',
  ];

  const delayKeywords = [
    'تأخير',
    'تأخرنا',
    'زحمة',
    'زحام',
    'عطل',
    'تعطلت',
    'تأجيل',
    'متأخر',
    'سنصل متأخرين',
    'delay',
    'late',
    'traffic',
  ];

  for (const kw of emergencyKeywords) {
    if (normalized.includes(kw)) {
      return {
        category: 'Emergency',
        confidence: 0.95,
        reason: `تم رصد مؤشر حالة طارئة (${kw}) في نص الرسالة الصوتية.`,
        suggestedAction: 'إشعار فريق عمليات الطوارئ والاتصال بالمرشد فوراً.',
        isEscalationRequired: true,
      };
    }
  }

  for (const kw of delayKeywords) {
    if (normalized.includes(kw)) {
      return {
        category: 'Delay',
        confidence: 0.9,
        reason: `تم رصد إشارة إلى تأخير في الموعد (${kw}) في نص الرسالة.`,
        suggestedAction: 'تعديل موعد الفعالية وإبلاغ مزود التجربة بالتأخير.',
        isEscalationRequired: true,
      };
    }
  }

  return {
    category: 'General',
    confidence: 0.85,
    reason: 'استفسار أو محادثة عامة لا تستدعي تصعيداً تشغيلياً.',
    suggestedAction: 'تسجيل الرسالة للمتابعة الاعتيادية.',
    isEscalationRequired: false,
  };
}

/**
 * Classifies the intent of transcribed voice notes into:
 * - 'Delay' (e.g., traffic, car breakdown, delayed arrival)
 * - 'Emergency' (e.g., medical issue, lost traveler, severe accident)
 * - 'General' (e.g., general inquiry, compliment, casual query)
 */
export async function classifyVoiceIntent(
  transcriptionText: string,
  apiKey = process.env.OPENAI_API_KEY
): Promise<IntentClassificationResult> {
  if (!transcriptionText || transcriptionText.trim().length === 0) {
    return {
      category: 'General',
      confidence: 1.0,
      reason: 'نص صوتي فارغ.',
      suggestedAction: 'لا يتطلب أي إجراء.',
      isEscalationRequired: false,
    };
  }

  if (!apiKey) {
    console.warn(
      'OPENAI_API_KEY is not configured. Falling back to local heuristic intent classification.'
    );
    return heuristicClassify(transcriptionText);
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
          { role: 'user', content: `Transcribed Arabic Voice Message:\n"${transcriptionText}"` },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
      }),
    });

    if (!response.ok) {
      console.error(
        `OpenAI chat completion error (${response.status}), using heuristic fallback.`
      );
      return heuristicClassify(transcriptionText);
    }

    const data = (await response.json()) as OpenAiChatCompletionResponse;
    const content = data.choices?.[0]?.message?.content;

    if (!content) {
      return heuristicClassify(transcriptionText);
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
      confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.9,
      reason: parsed.reason || '',
      suggestedAction: parsed.suggestedAction || '',
      isEscalationRequired,
    };
  } catch (err) {
    console.error('LLM intent classification error, using heuristic fallback:', err);
    return heuristicClassify(transcriptionText);
  }
}
