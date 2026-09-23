import { AIEvaluationRunner } from '../src/lib/ai/eval-runner';
import { checkEvaluationRegression, EvaluationBaseline } from '../src/lib/ai/eval-regression';
import { recordEvaluationHistory } from '../src/lib/ai/evaluation-history';
import { EVALUATION_BENCHMARK_DATASET } from '../tests/ai/evaluation-dataset';
import fs from 'fs';
import path from 'path';

export async function runAIEvaluationCIGate(): Promise<{ passed: boolean; violations: string[] }> {
  const baselinePath = path.resolve(process.cwd(), 'src/lib/ai/baseline-metrics.json');
  let baseline: EvaluationBaseline = {
    minIntentAccuracyPercentage: 90.0,
    minDisambiguationPrecisionPercentage: 85.0,
    minInjectionBlockRatePercentage: 95.0,
    maxP95LatencyMs: 3500,
  };

  if (fs.existsSync(baselinePath)) {
    try {
      const raw = fs.readFileSync(baselinePath, 'utf8');
      baseline = JSON.parse(raw);
    } catch {}
  }

  const runner = new AIEvaluationRunner();
  const metrics = await runner.runBenchmark(EVALUATION_BENCHMARK_DATASET);

  const regressionReport = checkEvaluationRegression(metrics, baseline);

  const commitSha = process.env.GITHUB_SHA || process.env.GIT_COMMIT || 'local-head';
  const promptVersion = '2.0.0';
  const datasetVersion = '1.2.0';

  recordEvaluationHistory({
    id: `eval-${Date.now()}`,
    commitSha,
    model: metrics.model,
    promptVersion,
    datasetVersion,
    timestamp: metrics.evaluatedAt,
    metrics: {
      totalScenarios: metrics.totalScenarios,
      passedCount: metrics.passedCount,
      failedCount: metrics.failedCount,
      intentAccuracyPercentage: metrics.intentAccuracyPercentage,
      disambiguationPrecisionPercentage: metrics.disambiguationPrecisionPercentage,
      injectionBlockRatePercentage: metrics.injectionBlockRatePercentage,
      meanLatencyMs: metrics.meanLatencyMs,
      p95LatencyMs: metrics.p95LatencyMs,
    },
    passedGate: !regressionReport.hasRegression,
    regressions: regressionReport.violations,
  });

  return {
    passed: !regressionReport.hasRegression,
    violations: regressionReport.violations,
  };
}

if (process.argv[1] && process.argv[1].endsWith('ci-ai-eval-gate.ts')) {
  runAIEvaluationCIGate()
    .then((result) => {
      if (result.passed) {
        process.stdout.write('AI Evaluation CI Gate: PASSED (All thresholds satisfied)\n');
        process.exit(0);
      } else {
        process.stderr.write(`AI Evaluation CI Gate: FAILED\n${result.violations.join('\n')}\n`);
        process.exit(1);
      }
    })
    .catch((err) => {
      process.stderr.write(`AI Evaluation CI Gate Error: ${err}\n`);
      process.exit(1);
    });
}
