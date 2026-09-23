export interface PromptMetadata {
  id: string;
  version: string;
  name: string;
  description: string;
  author: string;
  createdAt: string;
  recommendedModel: string;
  recommendedTemperature: number;
}

export interface PromptDefinition<TInput = Record<string, unknown>> {
  metadata: PromptMetadata;
  getSystemPrompt: (context?: TInput) => string;
  formatUserPrompt: (input: TInput) => string;
}
