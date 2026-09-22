import { EmbeddingService, ProviderEmbeddingPayload } from '../ports/embeddings.port';
import { generateTextEmbedding, generateProviderEmbedding } from '../ai/embeddings';

export class OnnxEmbeddingAdapter implements EmbeddingService {
  async generateTextEmbedding(text: string): Promise<number[]> {
    return generateTextEmbedding(text);
  }

  async generateProviderEmbedding(provider: ProviderEmbeddingPayload): Promise<number[]> {
    return generateProviderEmbedding({
      name: provider.name,
      city: provider.city,
      experience_type: provider.experience_type,
      capacity: provider.capacity ?? 10,
      verification_status: (provider.verification_status as 'pending' | 'verified' | 'rejected') || 'verified',
    });
  }
}
