import { LLMProvider, LLMGenerateRequest, LLMGenerateResponse } from '../ports/llm.port';
import { callLLMJson } from '../ai/llm-client';

export class GroqLLMAdapter implements LLMProvider {
  async generateJson<T = unknown>(request: LLMGenerateRequest<T>): Promise<LLMGenerateResponse<T>> {
    const startTime = Date.now();
    const response = await callLLMJson<T>({
      systemPrompt: request.systemPrompt,
      userPrompt: request.userPrompt,
      temperature: request.temperature,
    });
    const latencyMs = Date.now() - startTime;

    let data = response.data;
    if (request.schema) {
      data = request.schema.parse(response.data);
    }

    return {
      data,
      raw: response.rawText,
      model: response.model,
      latencyMs,
    };
  }
}
