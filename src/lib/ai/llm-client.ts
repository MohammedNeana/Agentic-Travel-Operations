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
  const { systemPrompt, userPrompt, temperature = 0.2, maxTokens } = options;

  const groqApiKey = process.env.GROQ_API_KEY;
  const groqPrimaryModel = process.env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile';
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const localUrl = process.env.LOCAL_LLM_URL;
  const localModel = process.env.LOCAL_LLM_MODEL || 'llama3.2';

  const candidateEndpoints: Array<{
    provider: 'groq' | 'openai' | 'local';
    model: string;
    url: string;
    apiKey?: string;
    isLocal?: boolean;
  }> = [];

  if (localUrl) {
    candidateEndpoints.push({
      provider: 'local',
      model: localModel,
      url: localUrl,
      isLocal: true,
    });
  }

  if (groqApiKey) {
    candidateEndpoints.push(
      {
        provider: 'groq',
        model: groqPrimaryModel,
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
          ...(typeof maxTokens === 'number' ? { max_tokens: maxTokens } : {}),
        }),
      });

      if (!res.ok) {
        const errText = await res.text();
        lastError = new Error(`${target.provider} (${target.model}) HTTP ${res.status}: ${errText.slice(0, 180)}`);
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

      return {
        data: parsed,
        rawText: cleaned,
        model: target.model,
        provider: target.provider,
      };
    } catch (err) {
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
