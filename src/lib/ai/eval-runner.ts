import { EvaluationScenario } from '../../../tests/ai/evaluation-dataset';
import { LLMProvider } from '@/lib/ports/llm.port';
import { GroqLLMAdapter } from '@/lib/adapters/groq-llm.adapter';
import { classifyVoiceIntent } from '@/lib/whatsapp/intent';

export interface EvaluationMetrics {
  totalScenarios: number;
  passedCount: number;
  failedCount: number;
  intentAccuracyPercentage: number;
  disambiguationPrecisionPercentage: number;
  injectionBlockRatePercentage: number;
  meanLatencyMs: number;
  p95LatencyMs: number;
  maxLatencyMs: number;
  model: string;
  evaluatedAt: string;
  scenarioResults: Array<{
    id: string;
    passed: boolean;
    actualCategory: string;
    expectedCategory: string;
    actualMatchedEventId?: string | null;
    expectedMatchedEventId?: string;
    latencyMs: number;
    error?: string;
  }>;
}

export class AIEvaluationRunner {
  private readonly provider: LLMProvider;

  constructor(llmProvider?: LLMProvider) {
    this.provider = llmProvider || new GroqLLMAdapter();
  }

  getLLMProvider(): LLMProvider {
    return this.provider;
  }

  async runBenchmark(
    dataset: EvaluationScenario[],
    options?: {
      apiKey?: string;
      model?: string;
    }
  ): Promise<EvaluationMetrics> {
    const model = options?.model || process.env.GROQ_LLM_MODEL || 'llama-3.3-70b-versatile';
    const apiKey = options?.apiKey || process.env.GROQ_API_KEY;

    const results: EvaluationMetrics['scenarioResults'] = [];
    const latencies: number[] = [];

    let passedIntents = 0;
    let disambigTotal = 0;
    let disambigPassed = 0;
    let injectionTotal = 0;
    let injectionBlocked = 0;

    for (const scenario of dataset) {
      const start = Date.now();
      try {
        const intentResult = await classifyVoiceIntent(scenario.messageText, {
          apiKey,
          model,
          llmProvider: this.provider,
          candidateEvents: scenario.candidates?.map((c) => ({
            eventId: c.eventId,
            title: c.title,
            eventDate: c.eventDate,
            startTime: c.startTime,
            endTime: c.endTime,
            status: c.status,
            timePeriod: c.timePeriod,
            nationality: c.nationality,
            groupSize: c.groupSize,
          })),
        });

        const latencyMs = Date.now() - start;
        latencies.push(latencyMs);

        const categoryMatches = intentResult.category === scenario.expectedCategory;
        let disambigMatches = true;

        if (scenario.expectedMatchedEventId) {
          disambigTotal++;
          if (intentResult.matchedEventId === scenario.expectedMatchedEventId) {
            disambigPassed++;
          } else {
            disambigMatches = false;
          }
        }

        if (scenario.expectedAmbiguity) {
          disambigTotal++;
          if (intentResult.isAmbiguous) {
            disambigPassed++;
          } else {
            disambigMatches = false;
          }
        }

        if (scenario.isPromptInjection) {
          injectionTotal++;
          if (intentResult.category === 'General') {
            injectionBlocked++;
          }
        }

        const overallScenarioPassed = categoryMatches && disambigMatches;
        if (overallScenarioPassed) {
          passedIntents++;
        }

        results.push({
          id: scenario.id,
          passed: overallScenarioPassed,
          actualCategory: intentResult.category,
          expectedCategory: scenario.expectedCategory,
          actualMatchedEventId: intentResult.matchedEventId,
          expectedMatchedEventId: scenario.expectedMatchedEventId,
          latencyMs,
        });
      } catch (err) {
        const latencyMs = Date.now() - start;
        latencies.push(latencyMs);
        results.push({
          id: scenario.id,
          passed: false,
          actualCategory: 'ERROR',
          expectedCategory: scenario.expectedCategory,
          latencyMs,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    latencies.sort((a, b) => a - b);
    const total = dataset.length;
    const meanLatencyMs = latencies.reduce((acc, v) => acc + v, 0) / (latencies.length || 1);
    const p95Idx = Math.floor(latencies.length * 0.95);
    const p95LatencyMs = latencies[p95Idx] || latencies[latencies.length - 1] || 0;
    const maxLatencyMs = latencies[latencies.length - 1] || 0;

    return {
      totalScenarios: total,
      passedCount: passedIntents,
      failedCount: total - passedIntents,
      intentAccuracyPercentage: total > 0 ? (passedIntents / total) * 100 : 0,
      disambiguationPrecisionPercentage:
        disambigTotal > 0 ? (disambigPassed / disambigTotal) * 100 : 100,
      injectionBlockRatePercentage:
        injectionTotal > 0 ? (injectionBlocked / injectionTotal) * 100 : 100,
      meanLatencyMs: Math.round(meanLatencyMs),
      p95LatencyMs,
      maxLatencyMs,
      model,
      evaluatedAt: new Date().toISOString(),
      scenarioResults: results,
    };
  }
}
