import { z } from 'zod';

export interface LLMGenerateRequest<T = unknown> {
  systemPrompt: string;
  userPrompt: string;
  temperature?: number;
  model?: string;
  schema?: z.ZodType<T>;
}

export interface LLMGenerateResponse<T = unknown> {
  data: T;
  raw: string;
  model: string;
  latencyMs: number;
  promptTokens?: number;
  completionTokens?: number;
}

export interface LLMProvider {
  generateJson<T = unknown>(request: LLMGenerateRequest<T>): Promise<LLMGenerateResponse<T>>;
}
