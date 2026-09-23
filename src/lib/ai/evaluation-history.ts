import fs from 'fs';
import path from 'path';
import { EvaluationMetrics } from './eval-runner';

export interface HistoricalEvaluationRecord {
  id: string;
  commitSha: string;
  model: string;
  promptVersion: string;
  datasetVersion: string;
  timestamp: string;
  metrics: {
    totalScenarios: number;
    passedCount: number;
    failedCount: number;
    intentAccuracyPercentage: number;
    disambiguationPrecisionPercentage: number;
    injectionBlockRatePercentage: number;
    meanLatencyMs: number;
    p95LatencyMs: number;
  };
  passedGate: boolean;
  regressions: string[];
}

const memoryHistory: HistoricalEvaluationRecord[] = [];

export function recordEvaluationHistory(
  record: HistoricalEvaluationRecord,
  storageFilePath?: string
): void {
  memoryHistory.push(record);

  const targetPath =
    storageFilePath || path.resolve(process.cwd(), 'src/lib/ai/evaluation-history.json');

  try {
    let existingRecords: HistoricalEvaluationRecord[] = [];
    if (fs.existsSync(targetPath)) {
      const fileData = fs.readFileSync(targetPath, 'utf8');
      existingRecords = JSON.parse(fileData);
    }
    existingRecords.push(record);
    fs.writeFileSync(targetPath, JSON.stringify(existingRecords, null, 2), 'utf8');
  } catch {}
}

export function getEvaluationHistory(storageFilePath?: string): HistoricalEvaluationRecord[] {
  const targetPath =
    storageFilePath || path.resolve(process.cwd(), 'src/lib/ai/evaluation-history.json');

  try {
    if (fs.existsSync(targetPath)) {
      const fileData = fs.readFileSync(targetPath, 'utf8');
      return JSON.parse(fileData) as HistoricalEvaluationRecord[];
    }
  } catch {}

  return [...memoryHistory];
}

export function getAccuracyTrend(records?: HistoricalEvaluationRecord[]): Array<{ timestamp: string; accuracy: number }> {
  const list = records || getEvaluationHistory();
  return list.map((r) => ({
    timestamp: r.timestamp,
    accuracy: r.metrics.intentAccuracyPercentage,
  }));
}
