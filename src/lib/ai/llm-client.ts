/**
 * Centralized, multi-provider LLM Client for There DMC.
 * Prioritizes your Local LLM for general reasoning & operational orchestration,
 * while reserving Groq for fast inference & Whisper audio transcription:
 *
 * 1. Local LLM (Ollama / LM Studio / Local Python Server at http://127.0.0.1:11434 or 1234 or 8000)
 * 2. Groq: llama-3.3-70b-versatile (Flagship cloud model)
 * 3. Groq: llama-3.1-8b-instant (Fast cloud model)
 * 4. OpenAI: gpt-4o-mini (Backup)
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
  provider: 'local' | 'groq' | 'openai';
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

  const localUrl =
    process.env.LOCAL_LLM_URL ||
    'http://127.0.0.1:11434/v1/chat/completions'; // Default Ollama OpenAI-compatible endpoint
  const localModel = process.env.LOCAL_LLM_MODEL || 'llama3.2';

  const groqApiKey = process.env.GROQ_API_KEY;
  const openaiApiKey = process.env.OPENAI_API_KEY;

  // Candidate endpoints ordered by priority: Local LLM -> Groq -> OpenAI
  const candidateEndpoints: Array<{
    provider: 'local' | 'groq' | 'openai';
    model: string;
    url: string;
    apiKey?: string;
    isLocal?: boolean;
  }> = [
    // 1. Local LLM (Prioritized if active or configured)
    {
      provider: 'local',
      model: localModel,
      url: localUrl,
      isLocal: true,
    },
    // 2. Local LM Studio alternative port (if Ollama wasn't the target)
    {
      provider: 'local',
      model: 'local-model',
      url: 'http://127.0.0.1:1234/v1/chat/completions',
      isLocal: true,
    },
    // 3. Groq Flagship Llama 3.3 70B
    {
      provider: 'groq',
      model: 'llama-3.3-70b-versatile',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqApiKey,
    },
    // 4. Groq Ultra-fast Llama 3.1 8B
    {
      provider: 'groq',
      model: 'llama-3.1-8b-instant',
      url: 'https://api.groq.com/openai/v1/chat/completions',
      apiKey: groqApiKey,
    },
    // 5. OpenAI GPT-4o-mini
    {
      provider: 'openai',
      model: 'gpt-4o-mini',
      url: 'https://api.openai.com/v1/chat/completions',
      apiKey: openaiApiKey,
    },
  ];

  let lastError: Error | null = null;

  for (const target of candidateEndpoints) {
    // For cloud providers, skip if no API key is available
    if (!target.isLocal && !target.apiKey) {
      continue;
    }

    try {
      console.log(`[LLM Client] 🤖 Attempting call with ${target.provider.toUpperCase()} (${target.model}) at ${target.url}...`);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (target.apiKey) {
        headers['Authorization'] = `Bearer ${target.apiKey}`;
      }

      // For local LLMs, use a quick timeout (1.5s) to check if the server is responding,
      // avoiding long hangs if the local server is not currently running.
      const timeoutMs = target.isLocal ? 2000 : 30000;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      const res = await fetch(target.url, {
        method: 'POST',
        headers,
        signal: controller.signal,
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

      clearTimeout(timer);

      if (!res.ok) {
        const errText = await res.text();
        console.warn(
          `[LLM Client] ⚠️ ${target.provider} (${target.model}) returned HTTP ${res.status}: ${errText.slice(0, 200)}`
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

      console.log(`[LLM Client] 🎯 Successfully completed with ${target.provider.toUpperCase()} (${target.model})`);

      return {
        data: parsed,
        rawText: cleaned,
        model: target.model,
        provider: target.provider,
      };
    } catch (err) {
      if (target.isLocal) {
        console.log(`[LLM Client] ℹ️ Local LLM at ${target.url} is not currently responding. Falling forward to next candidate...`);
      } else {
        console.error(`[LLM Client] ❌ Cloud provider ${target.provider} error:`, err);
      }
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }

  throw (
    lastError ||
    new Error('All LLM endpoints (Local LLM, Groq, OpenAI) failed. Please ensure at least one model is accessible.')
  );
}
