import type { ExtractedExperienceProvider } from './extraction';

/**
 * Generates a deterministic normalized 1536-dimensional pseudo-vector
 * used as a local fallback when OpenAI API key is unavailable.
 */
function generateDeterministicEmbedding(text: string): number[] {
  const dimensions = 1536;
  const vector: number[] = new Array(dimensions).fill(0);

  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash << 5) - hash + text.charCodeAt(i);
    hash |= 0;
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    // Generate pseudo-random value seeded with hash and dimension index
    const seed = (hash + i * 2654435761) >>> 0;
    const val = (seed % 2000 - 1000) / 1000;
    vector[i] = val;
    norm += val * val;
  }

  // Normalize vector to unit length
  const sqrtNorm = Math.sqrt(norm) || 1;
  for (let i = 0; i < dimensions; i++) {
    vector[i] = Number((vector[i] / sqrtNorm).toFixed(6));
  }

  return vector;
}

/**
 * Generates a 1536-dimensional vector embedding for a Saudi experience provider profile
 * using OpenAI's `text-embedding-3-small` model.
 */
export async function generateProviderEmbedding(
  provider: ExtractedExperienceProvider,
  apiKey = process.env.OPENAI_API_KEY
): Promise<number[]> {
  // Combine name, city, and experience type into a rich semantic representation
  const inputSemanticText = `${provider.name} | ${provider.city} | ${provider.experience_type} (سعة: ${provider.capacity} ضيوف)`;

  if (!apiKey) {
    console.warn(
      'OPENAI_API_KEY is not configured in environment. Using deterministic 1536-dimensional fallback vector.'
    );
    return generateDeterministicEmbedding(inputSemanticText);
  }

  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: inputSemanticText,
        dimensions: 1536,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(
        `OpenAI embeddings API error (${response.status}): ${errorText}. Using fallback embedding vector.`
      );
      return generateDeterministicEmbedding(inputSemanticText);
    }

    const data = await response.json();
    const embedding = data.data?.[0]?.embedding;

    if (!Array.isArray(embedding) || embedding.length !== 1536) {
      console.warn(
        `Unexpected embedding dimensions returned (${embedding?.length ?? 0}). Expected 1536.`
      );
      return generateDeterministicEmbedding(inputSemanticText);
    }

    return embedding as number[];
  } catch (err) {
    console.error('Failed to generate vector embedding via OpenAI, using fallback:', err);
    return generateDeterministicEmbedding(inputSemanticText);
  }
}
