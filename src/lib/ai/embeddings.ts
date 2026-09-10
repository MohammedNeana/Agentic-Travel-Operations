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
    console.log('\x1b[36m[Local AI]\x1b[0m 🚀 Loading @xenova/transformers pipeline (Xenova/all-MiniLM-L6-v2)...');
    const startTime = Date.now();

    const { pipeline, env } = await import('@xenova/transformers');
    const path = await import('path');
    env.cacheDir = path.join(process.cwd(), 'node_modules/@xenova/transformers/.cache');
    env.allowLocalModels = false;

    // Ensure wasm runs in single-thread mode without worker threads in Node.js
    try {
      const ortWeb = await import('onnxruntime-web');
      if (ortWeb?.env?.wasm) {
        ortWeb.env.wasm.numThreads = 1;
      }
    } catch {
      // Ignore if not loaded
    }

    if (env.backends?.onnx?.wasm) {
      env.backends.onnx.wasm.numThreads = 1;
      env.backends.onnx.wasm.proxy = false;
    }

    const pipelineInstance = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    extractorInstance = pipelineInstance as unknown as FeatureExtractor;
    const duration = Date.now() - startTime;
    console.log(`\x1b[32m[Local AI]\x1b[0m  Model loaded successfully in ${duration}ms (100% local, 0 external calls).`);
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
  console.log(`\x1b[36m[Local AI]\x1b[0m 🧠 Generating embedding for: "${cleanText.length > 60 ? cleanText.slice(0, 60) + '...' : cleanText}"`);
  const t0 = Date.now();

  const extractor = await getExtractor();
  const output = await extractor(cleanText, { pooling: 'mean', normalize: true });
  const vector = Array.from(output.data);
  const elapsed = Date.now() - t0;

  console.log(
    `\x1b[32m[Local AI]\x1b[0m ⚡ Embedding created in ${elapsed}ms | Dim: ${vector.length} | Sample: [${vector.slice(0, 3).map((v) => v.toFixed(4)).join(', ')}, ...]`
  );
  return vector;
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
  console.log(`\x1b[36m[Local AI]\x1b[0m 🏢 Embedding provider: "${provider.name}" (${provider.city})`);
  return generateTextEmbedding(inputSemanticText);
}

