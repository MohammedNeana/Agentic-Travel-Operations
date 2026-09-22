export interface ProviderEmbeddingPayload {
  name: string;
  city: string;
  experience_type: string;
  capacity?: number;
  verification_status?: string;
}

export interface EmbeddingService {
  generateTextEmbedding(text: string): Promise<number[]>;
  generateProviderEmbedding(provider: ProviderEmbeddingPayload): Promise<number[]>;
}
