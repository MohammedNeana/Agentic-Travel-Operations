import type { ExtractedExperienceProvider } from './extraction';

type FeatureExtractor = (
  text: string | string[],
  options?: { pooling?: 'none' | 'mean' | 'cls'; normalize?: boolean }
) => Promise<{ data: Float32Array }>;

let extractorInstance: FeatureExtractor | null = null;
let extractorPromise: Promise<FeatureExtractor> | null = null;

/**
 * Returns a singleton feature-extraction pipeline using Xenova/all-MiniLM-L6-v2.
 * Initializes once on the server and is reused across all requests.
 */
async function getExtractor(): Promise<FeatureExtractor> {
  if (extractorInstance) {
    return extractorInstance;
  }
  if (extractorPromise) {
    return extractorPromise;
  }

  extractorPromise = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    // Allow remote model downloading from Hugging Face cache
    env.allowLocalModels = false;

    const pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    extractorInstance = pipelineInstance as unknown as FeatureExtractor;
    return extractorInstance;
  })();

  return extractorPromise;
}

/**
 * Generates a real 384-dimensional dense vector embedding for arbitrary input text
 * locally using @xenova/transformers ('Xenova/all-MiniLM-L6-v2').
 * 100% free, 0 paid APIs, 0 mock data.
 */
export async function generateTextEmbedding(
  text: string,
  _apiKey?: string
): Promise<number[]> {
  const cleanText = text && text.trim().length > 0 ? text.trim() : 'تجربة سياحية سعودية أصيلة';
  const extractor = await getExtractor();
  const output = await extractor(cleanText, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

/**
 * Generates a real 384-dimensional dense vector embedding for a Saudi experience provider profile
 * locally using @xenova/transformers ('Xenova/all-MiniLM-L6-v2').
 */
export async function generateProviderEmbedding(
  provider: ExtractedExperienceProvider,
  _apiKey?: string
): Promise<number[]> {
  const inputSemanticText = `${provider.name} | ${provider.city} | ${provider.experience_type} (سعة: ${provider.capacity} ضيوف)`;
  return generateTextEmbedding(inputSemanticText);
}

