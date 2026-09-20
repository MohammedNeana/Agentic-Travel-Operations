import type { IntentCategory, IntentClassificationResult, CandidateGroupEvent } from './types';

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

export interface ClassifyIntentOptions {
  candidateEvents?: CandidateGroupEvent[];
  apiKey?: string;
  model?: string;
}

function formatCandidateEventsForPrompt(events: CandidateGroupEvent[]): string {
  if (!events || events.length === 0) {
    return 'No specific pre-registered candidate groups provided.';
  }

  return events
    .map((ev, index) => {
      const dietary =
        ev.dietaryRestrictions && ev.dietaryRestrictions.length > 0
          ? `\n  - القيود الغذائية: ${ev.dietaryRestrictions.join('، ')}`
          : '';
      const mobility = ev.mobilityNotes ? `\n  - ملاحظات التنقل: ${ev.mobilityNotes}` : '';

      return `[المجموعة ${index + 1}]:
  - معرف الفعالية (eventId): "${ev.eventId}"
  - عنوان التجربة: "${ev.title}"
  - التاريخ: ${ev.eventDate}
  - التوقيت: من ${ev.startTime} إلى ${ev.endTime} (${ev.timePeriod || ''})
  - السياق الزمني النسبي: ${ev.timeContextDescription || ev.timeContext || 'غير محدد'}
  - الحالة الراهنة: ${ev.status}
  - جنسية الوفد: ${ev.nationality || 'دولي'}
  - عدد الضيوف: ${ev.groupSize || 2} أشخاص${dietary}${mobility}`;
    })
    .join('\n\n');
}

export async function classifyVoiceIntent(
  transcriptionText: string,
  optionsOrApiKey?: string | ClassifyIntentOptions,
  legacyModel?: string
): Promise<IntentClassificationResult> {
  if (!transcriptionText || transcriptionText.trim().length === 0) {
    throw new Error('Cannot classify intent: Transcribed voice note text is empty.');
  }

  let apiKey = process.env.GROQ_API_KEY;
  let model = process.env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile';
  let candidateEvents: CandidateGroupEvent[] | undefined;

  if (typeof optionsOrApiKey === 'string') {
    apiKey = optionsOrApiKey;
    if (legacyModel) model = legacyModel;
  } else if (typeof optionsOrApiKey === 'object' && optionsOrApiKey !== null) {
    if (optionsOrApiKey.apiKey) apiKey = optionsOrApiKey.apiKey;
    if (optionsOrApiKey.model) model = optionsOrApiKey.model;
    candidateEvents = optionsOrApiKey.candidateEvents;
  }

  if (!apiKey) {
    throw new Error(
      'GROQ_API_KEY is not configured in .env.local. Please add your free Groq API key to enable real LLM intent classification.'
    );
  }

  const systemPrompt = `You are an AI Incident Dispatcher & Booking Coordinator for a Saudi Destination Management Company (DMC).
You analyze incoming WhatsApp messages (text or transcribed voice notes) from experience providers, suppliers, and tour guides.

The provider may have multiple separate traveler groups (e.g., one group running right now, one group starting in a while / upcoming, or one group from earlier, with different group sizes or nationalities).

YOUR CRITICAL OBJECTIVES:
1. Classify the intent into strictly one of these categories:
   - "Acceptance": The supplier confirms, accepts, or agrees to the booking request (e.g., "تم التأكيد", "نؤكد الحجز", "جاهزون للاستقبال", "نعم متاحين").
   - "Rejection": The supplier declines, rejects, apologizes, or states they are unavailable (e.g., "نعتذر", "غير متاحين", "المكان محجوز بالكامل", "لا يمكننا الاستقبال").
   - "Delay": Travel delays, traffic jams, vehicle breakdowns, or requests to postpone the start time.
   - "Emergency": Medical issues, injuries, accidents, lost persons, safety incidents.
   - "General": Casual queries, routine questions, or greetings.

2. MULTI-GROUP DISAMBIGUATION (CRITICAL):
   - You MUST determine WHICH SPECIFIC GROUP/EVENT the provider is referring to from the candidate list below.
   - Examine timing clues:
     * "اللي شغال الحين", "الحين", "حالياً" -> refers to the running_now group.
     * "بعد شوي", "القادم", "القروب الثاني", "العصر", "المساء", "الساعة 4" -> refers to the upcoming / later group.
     * "الصباح", "اللي راح", "الأولى", "أمس" -> refers to the earlier or morning group.
   - Examine group demographics:
     * Nationality: e.g., "الإيطاليين", "اليابانيين", "الألمان".
     * Group size: e.g., "الـ 6 أشخاص", "المجموعة الكبيرة", "شخصين", "الـ 4".
     * Activity or title keywords.
    - Set "matchedEventId" to the exact eventId of the matched group. If no candidate groups exist or the message is completely generic, set it to null.
    - Set "matchedGroupSummary" to a concise Arabic description of the matched group (e.g. "وفد إيطالي (6 أشخاص) - موعد العصر 15:00").
    - If multiple candidate groups exist and the message is ambiguous (cannot tell which group is affected), set "isAmbiguous": true, explain the ambiguity in "reason", and suggest DMC operations to verify.

3. CONVERSATIONAL CLARIFICATION & KEEPING THE CHAT OPEN:
   - When "isAmbiguous" is true (the message is not specific enough to determine which group they mean, or you need more details from the provider):
     You MUST generate "clarificationMessage" containing a warm, polite, and natural human-like Arabic WhatsApp reply from the DMC operations coordinator to send back to the provider.
     Guidelines for "clarificationMessage":
     * Tone: Natural, friendly, and respectful Saudi Arabic hospitality style (e.g. "حياك الله أخوي الكريم", "الله يسعدك", "ودنا نتأكد معك").
     * NO static templates or robotic bot phrases. Keep the conversation open and fluid!
     * Specifically reference the candidate groups they have with distinguishing traits (e.g. mention the running group in the morning vs. the upcoming afternoon group of 6 people, or their respective times/nationalities).
     * Ask them politely to clarify which group they meant so you can take immediate action and update the schedule.
     * Encourage them to reply simply with a quick text or voice note.
   - If "isAmbiguous" is false, "clarificationMessage" should be null.

Respond ONLY with valid JSON in this exact structure:
{
  "category": "Acceptance" | "Rejection" | "Delay" | "Emergency" | "General",
  "confidence": 0.95,
  "matchedEventId": "eventId-string" | null,
  "matchedGroupSummary": "Arabic summary of matched group" | null,
  "isAmbiguous": false,
  "clarificationMessage": "Warm human-like Arabic reply asking for clarification if ambiguous, or null",
  "reason": "Brief explanation in Arabic of why this category was chosen AND why this specific group was identified",
  "suggestedAction": "Suggested action in Arabic for the DMC operations dashboard"
}`;

  const candidateBlock =
    candidateEvents && candidateEvents.length > 0
      ? `\n\n--- مجموعات الحجوزات النشطة للمزود (Candidate Groups for this Provider) ---\n${formatCandidateEventsForPrompt(
          candidateEvents
        )}`
      : '';

  const candidateModels = process.env.GROQ_LLM_MODEL
    ? [process.env.GROQ_LLM_MODEL]
    : [model, 'llama-3.1-8b-instant'];

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
            {
              role: 'user',
              content: `Incoming Arabic WhatsApp Message (Text or Transcribed Audio):\n"${transcriptionText}"${candidateBlock}`,
            },
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
        if (response.status === 404 || response.status === 400) {
          lastError = err;
          continue;
        }
        throw err;
      }

      const data = (await response.json()) as GroqChatCompletionResponse;
      const content = data.choices?.[0]?.message?.content;

      if (!content) {
        throw new Error(`Groq LLM (${currentModel}) returned an empty response content.`);
      }

      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as {
        category?: string;
        confidence?: number;
        matchedEventId?: string | null;
        matchedGroupSummary?: string | null;
        isAmbiguous?: boolean;
        clarificationMessage?: string | null;
        reason?: string;
        suggestedAction?: string;
      };

      let category: IntentCategory = 'General';
      if (parsed.category === 'Acceptance') category = 'Acceptance';
      else if (parsed.category === 'Rejection') category = 'Rejection';
      else if (parsed.category === 'Emergency') category = 'Emergency';
      else if (parsed.category === 'Delay') category = 'Delay';

      const isEscalationRequired = category === 'Emergency' || category === 'Delay';

      let matchedEventId: string | null = parsed.matchedEventId || null;
      if (!matchedEventId && candidateEvents && candidateEvents.length === 1) {
        matchedEventId = candidateEvents[0].eventId;
      }

      let matchedGroupSummary = parsed.matchedGroupSummary || undefined;
      if (matchedEventId && !matchedGroupSummary && candidateEvents) {
        const matched = candidateEvents.find((c) => c.eventId === matchedEventId);
        if (matched) {
          matchedGroupSummary = `وفد (${matched.nationality || 'دولي'}) ${matched.groupSize || ''} أشخاص - ${matched.startTime}`;
        }
      }

      let clarificationMessage = parsed.clarificationMessage?.trim() || undefined;
      if (parsed.isAmbiguous && !clarificationMessage && candidateEvents && candidateEvents.length > 1) {
        const groupsList = candidateEvents
          .map((c) => `رحلة (${c.timePeriod || c.startTime}) لـ ${c.nationality || 'وفد'}`)
          .join(' أو ');
        clarificationMessage = `حياك الله أخوي الكريم، الله يسعدك بس للتأكيد قصدك ${groupsList}؟ رد علي هنا برسالة أو فويس نوت عشان ننسق فوراً ونحدث الجدول`;
      }

      return {
        category,
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : 0.95,
        matchedEventId,
        matchedGroupSummary,
        isAmbiguous: Boolean(parsed.isAmbiguous),
        clarificationMessage,
        reason: parsed.reason || '',
        suggestedAction: parsed.suggestedAction || '',
        isEscalationRequired,
      };
    } catch (err: unknown) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (!lastError.message.includes('HTTP 404') && !lastError.message.includes('HTTP 400')) {
        throw lastError;
      }
    }
  }

  throw lastError || new Error('Failed to classify WhatsApp message intent with available Groq models.');
}

export const classifyWhatsAppMessageIntent = classifyVoiceIntent;
