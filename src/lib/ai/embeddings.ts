import type { ExtractedExperienceProvider } from './extraction';

type FeatureExtractor = (
  text: string | string[],
  options?: { pooling?: 'none' | 'mean' | 'cls'; normalize?: boolean }
) => Promise<{ data: Float32Array }>;

let extractorInstance: FeatureExtractor | null = null;
let extractorPromise: Promise<FeatureExtractor> | null = null;

async function getExtractor(): Promise<FeatureExtractor> {
  if (extractorInstance) {
    return extractorInstance;
  }
  if (extractorPromise) {
    return extractorPromise;
  }

  extractorPromise = (async () => {
    const { pipeline, env } = await import('@xenova/transformers');
    const path = await import('path');
    env.cacheDir = path.join(process.cwd(), 'node_modules/@xenova/transformers/.cache');
    env.allowLocalModels = false;

    try {
      const ortWeb = await import('onnxruntime-web');
      if (ortWeb?.env?.wasm) {
        ortWeb.env.wasm.numThreads = 1;
      }
    } catch {
      // Ignore
    }

    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }

    const pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    extractorInstance = pipelineInstance as unknown as FeatureExtractor;
    return extractorInstance;
  })();

  return extractorPromise;
}

export async function generateTextEmbedding(
  text: string,
  _apiKey?: string
): Promise<number[]> {
  const cleanText = text && text.trim().length > 0 ? text.trim() : 'تجربة سياحية سعودية أصيلة';
  const extractor = await getExtractor();
  const output = await extractor(cleanText, { pooling: 'mean', normalize: true });
  return Array.from(output.data);
}

export async function generateProviderEmbedding(
  provider: ExtractedExperienceProvider,
  _apiKey?: string
): Promise<number[]> {
  const inputSemanticText = `${provider.name} | ${provider.city} | ${provider.experience_type} (سعة: ${provider.capacity} ضيوف)`;
  return generateTextEmbedding(inputSemanticText);
}
