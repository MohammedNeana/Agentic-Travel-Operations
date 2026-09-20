/**
 * Centralized, multi-provider LLM Client for There DMC.
 *
 * Models hierarchy:
 * 1. Groq: llama-3.3-70b-versatile (Primary flagship, blazing fast sub-second inference)
 * 2. Groq: llama-3.1-8b-instant (Secondary high-throughput backup)
 * 3. OpenAI: gpt-4o-mini (Tertiary cloud fallback)
 * 4. Local LLM: enabled only if LOCAL_LLM_URL is explicitly set in .env.local
 */

export interface LLMRequestOptions {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}

export interface LLMResponse<T> {
  data: T;
  rawText: string;
  model: string;
  provider: 'groq' | 'openai' | 'local';
}

interface ChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: {
    message?: string;
    code?: string;
    type?: string;
  };
}

export async function callLLMJson<T = unknown>(options: LLMRequestOptions): Promise<LLMResponse<T>> {
  const { systemPrompt, userPrompt, temperature = 0.2 } = options;

  const groqApiKey = process.env.GROQ_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const localUrl = process.env.LOCAL_LLM_URL; // Only used if explicitly defined
  const localModel = process.env.LOCAL_LLM_MODEL || 'llama3.2';

  // Candidate endpoints ordered by priority
  const candidateEndpoints: Array<{
    provider: 'groq' | 'openai' | 'local';
    model: string;
    url: string;
    apiKey?: string;
    isLocal?: boolean;
  }> = [];

  // If the user explicitly configured a local LLM in .env.local, prioritize it
  if (localUrl) {
    candidateEndpoints.push({
      provider: 'local',
      model: localModel,
      url: localUrl,
      isLocal: true,
    });
  }

  // Primary: Groq Flagship Llama 3.3 70B
  if (groqApiKey) {
    candidateEndpoints.push(
      {
        provider: 'groq',
        model: 'llama-3.3-70b-versatile',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: groqApiKey,
      },
      {
        provider: 'groq',
        model: 'llama-3.1-8b-instant',
        url: 'https://api.groq.com/openai/v1/chat/completions',
        apiKey: groqApiKey,
      }
    );
  }

  // Fallback: OpenAI GPT-4o-mini
  if (openaiApiKey) {
    candidateEndpoints.push({
      provider: 'openai',
      model: 'gpt-4o-mini',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: openaiApiKey,
    });
  }

  let lastError: Error | null = null;

  for (const target of candidateEndpoints) {
    try {
      console.log(
        `[LLM Client] 🤖 Dispatching request to ${target.provider.toUpperCase()} (${target.model})...`
      );

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (target.apiKey) {
        headers['Authorization'] = `Bearer ${target.apiKey}`;
      }

      const res = await fetch(target.url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: target.model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
          response_format: { type: 'json_object' },
          temperature,
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        console.warn(
          `[LLM Client] ⚠️ ${target.provider} (${target.model}) returned HTTP ${res.status}: ${errText.slice(0, 180)}`
        );
        lastError = new Error(`${target.provider} (${target.model}) HTTP ${res.status}`);
        continue;
      }

      const json = (await res.json()) as ChatCompletionResponse;
      const content = json.choices?.[0]?.message?.content;

      if (!content || content.trim().length === 0) {
        lastError = new Error(`${target.provider} (${target.model}) returned empty response.`);
        continue;
      }

      const cleaned = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
      const parsed = JSON.parse(cleaned) as T;

      console.log(
        `[LLM Client] ⚡ Instant response received from ${target.provider.toUpperCase()} (${target.model})`
      );

      return {
        data: parsed,
        rawText: cleaned,
        model: target.model,
        provider: target.provider,
      };
    } catch (err) {
      console.error(`[LLM Client] ❌ Error with ${target.provider} (${target.model}):`, err);
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw (
    lastError ||
    new Error(
      'All LLM endpoints failed. Please check GROQ_API_KEY or OPENAI_API_KEY in .env.local.'
    )
  );
}
