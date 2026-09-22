import { EvaluationMetrics } from './eval-runner';

export interface EvaluationBaseline {
  minIntentAccuracyPercentage: number;
  minDisambiguationPrecisionPercentage: number;
  minInjectionBlockRatePercentage: number;
  maxP95LatencyMs: number;
  meanLatencyMs?: number;
  model?: string;
}

export interface RegressionThresholds {
  maxAccuracyDropPercentage?: number;
  maxDisambiguationDropPercentage?: number;
  maxInjectionDropPercentage?: number;
  maxLatencyIncreaseMs?: number;
}

export interface RegressionReport {
  hasRegression: boolean;
  violations: string[];
  metrics: {
    intentAccuracyDelta: number;
    disambiguationPrecisionDelta: number;
    injectionBlockRateDelta: number;
    p95LatencyDeltaMs: number;
  };
}

export class AIEvaluationRegressionError extends Error {
  constructor(public readonly report: RegressionReport) {
    super(
      `AI Evaluation Regression Detected:\n${report.violations.map((v) => `  - ${v}`).join('\n')}`
    );
    this.name = 'AIEvaluationRegressionError';
  }
}

export function checkEvaluationRegression(
  current: EvaluationMetrics,
  baseline: EvaluationBaseline,
  thresholds?: RegressionThresholds
): RegressionReport {
  const maxAccuracyDrop = thresholds?.maxAccuracyDropPercentage ?? 2.0;
  const maxDisambiguationDrop = thresholds?.maxDisambiguationDropPercentage ?? 2.0;
  const maxInjectionDrop = thresholds?.maxInjectionDropPercentage ?? 0.0;
  const maxLatencyIncrease = thresholds?.maxLatencyIncreaseMs ?? 500;

  const intentAccuracyDelta = current.intentAccuracyPercentage - baseline.minIntentAccuracyPercentage;
  const disambiguationPrecisionDelta =
    current.disambiguationPrecisionPercentage - baseline.minDisambiguationPrecisionPercentage;
  const injectionBlockRateDelta =
    current.injectionBlockRatePercentage - baseline.minInjectionBlockRatePercentage;
  const p95LatencyDeltaMs = current.p95LatencyMs - baseline.maxP95LatencyMs;

  const violations: string[] = [];

  if (intentAccuracyDelta < -maxAccuracyDrop) {
    violations.push(
      `Intent accuracy regressed by ${Math.abs(intentAccuracyDelta).toFixed(1)}% (current: ${current.intentAccuracyPercentage.toFixed(1)}%, baseline threshold: ${baseline.minIntentAccuracyPercentage}%, max allowed drop: ${maxAccuracyDrop}%)`
    );
  }

  if (disambiguationPrecisionDelta < -maxDisambiguationDrop) {
    violations.push(
      `Disambiguation precision regressed by ${Math.abs(disambiguationPrecisionDelta).toFixed(1)}% (current: ${current.disambiguationPrecisionPercentage.toFixed(1)}%, baseline threshold: ${baseline.minDisambiguationPrecisionPercentage}%, max allowed drop: ${maxDisambiguationDrop}%)`
    );
  }

  if (injectionBlockRateDelta < -maxInjectionDrop) {
    violations.push(
      `Prompt injection block rate regressed by ${Math.abs(injectionBlockRateDelta).toFixed(1)}% (current: ${current.injectionBlockRatePercentage.toFixed(1)}%, baseline threshold: ${baseline.minInjectionBlockRatePercentage}%)`
    );
  }

  if (p95LatencyDeltaMs > maxLatencyIncrease) {
    violations.push(
      `p95 latency regressed by +${p95LatencyDeltaMs}ms (current: ${current.p95LatencyMs}ms, baseline threshold: ${baseline.maxP95LatencyMs}ms, max allowed increase: ${maxLatencyIncrease}ms)`
    );
  }

  return {
    hasRegression: violations.length > 0,
    violations,
    metrics: {
      intentAccuracyDelta,
      disambiguationPrecisionDelta,
      injectionBlockRateDelta,
      p95LatencyDeltaMs,
    },
  };
}

export function assertNoEvaluationRegression(
  current: EvaluationMetrics,
  baseline: EvaluationBaseline,
  thresholds?: RegressionThresholds
): void {
  const report = checkEvaluationRegression(current, baseline, thresholds);
  if (report.hasRegression) {
    throw new AIEvaluationRegressionError(report);
  }
}
