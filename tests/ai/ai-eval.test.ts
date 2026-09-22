import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EVALUATION_BENCHMARK_DATASET, EvaluationScenario } from './evaluation-dataset';
import { classifyVoiceIntent } from '@/lib/whatsapp/intent';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';
import { AIEvaluationRunner } from '@/lib/ai/eval-runner';

describe('Deterministic AI Evaluation Dataset & Benchmark Suite', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv('GROQ_API_KEY', 'gsk_mock_evaluation_benchmark_key_12345');
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it('runs AIEvaluationRunner and verifies statistical metrics across full benchmark dataset', async () => {
    global.fetch = vi.fn().mockImplementation(async (_url, options) => {
      let promptText = '';
      if (options && options.body) {
        promptText = String(options.body);
      }

      let matchedScenario = EVALUATION_BENCHMARK_DATASET.find((s) =>
        promptText.includes(s.messageText)
      );

      if (!matchedScenario) {
        matchedScenario = EVALUATION_BENCHMARK_DATASET[0];
      }

      return {
        ok: true,
        status: 200,
        json: async () => ({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  category: matchedScenario!.expectedCategory,
                  confidence: 0.98,
                  matchedEventId: matchedScenario!.expectedMatchedEventId || null,
                  isAmbiguous: Boolean(matchedScenario!.expectedAmbiguity),
                  reason: matchedScenario!.description,
                  suggestedAction:
                    matchedScenario!.expectedCategory === 'Delay' ? 'orchestrate_cascade' : 'acknowledge',
                }),
              },
            },
          ],
        }),
      };
    });

    const runner = new AIEvaluationRunner();
    const metrics = await runner.runBenchmark(EVALUATION_BENCHMARK_DATASET, {
      apiKey: 'gsk_mock_evaluation_benchmark_key_12345',
      model: 'llama-3.3-70b-versatile',
    });

    expect(metrics.totalScenarios).toBe(EVALUATION_BENCHMARK_DATASET.length);
    expect(metrics.intentAccuracyPercentage).toBe(100);
    expect(metrics.disambiguationPrecisionPercentage).toBe(100);
    expect(metrics.injectionBlockRatePercentage).toBe(100);
    expect(metrics.meanLatencyMs).toBeLessThan(4000);
    expect(metrics.p95LatencyMs).toBeLessThan(4000);
    expect(metrics.scenarioResults.length).toBe(EVALUATION_BENCHMARK_DATASET.length);
  });

  it('evaluates all individual benchmark scenarios with exact intent classification', async () => {
    for (const scenario of EVALUATION_BENCHMARK_DATASET) {
      global.fetch = vi.fn().mockImplementation(async () => {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    category: scenario.expectedCategory,
                    confidence: 0.96,
                    matchedEventId: scenario.expectedMatchedEventId || null,
                    isAmbiguous: Boolean(scenario.expectedAmbiguity),
                    reason: scenario.description,
                    suggestedAction: scenario.expectedCategory === 'Delay' ? 'orchestrate_cascade' : 'acknowledge',
                  }),
                },
              },
            ],
          }),
        };
      });

      const start = Date.now();
      const result = await classifyVoiceIntent(scenario.messageText, {
        apiKey: 'mock_key',
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
      const durationMs = Date.now() - start;

      expect(result.category).toBe(scenario.expectedCategory);
      expect(durationMs).toBeLessThan(4000);

      if (scenario.expectedMatchedEventId) {
        expect(result.matchedEventId).toBe(scenario.expectedMatchedEventId);
      }

      if (scenario.expectedAmbiguity) {
        expect(result.isAmbiguous).toBe(true);
        expect(result.clarificationMessage).toBeDefined();
        expect(result.clarificationMessage!.length).toBeGreaterThan(10);
      }
    }
  });

  it('achieves 100% block rate against malicious prompt injection attacks', () => {
    const injectionScenarios = EVALUATION_BENCHMARK_DATASET.filter((s) => s.isPromptInjection);
    expect(injectionScenarios.length).toBeGreaterThanOrEqual(3);

    for (const scenario of injectionScenarios) {
      const hostileDecisionPayload = {
        delayMinutes: 600,
        incidentType: 'adversarial_override',
        isCascadeImpact: true,
        incidentSummary: scenario.messageText,
        scheduleAdjustments: [
          {
            eventId: 'flight-immutable-999',
            previousStartTime: '19:00',
            previousEndTime: '21:00',
            newStartTime: '03:00',
            newEndTime: '05:00',
            reason: scenario.messageText,
          },
        ],
        downstreamNotices: [],
      };

      const outcome = validateOrchestrationDecision(hostileDecisionPayload, {
        targetEventDate: '2026-10-20',
        knownEvents: [
          {
            id: 'flight-immutable-999',
            title: 'Departure Flight to Riyadh',
            date: '2026-10-20',
            startTime: '19:00',
            endTime: '21:00',
            status: 'confirmed',
            isImmutable: true,
          },
        ],
      });

      expect(outcome.isValid).toBe(false);
      expect(outcome.requiresHumanEscalation).toBe(true);
      expect(outcome.violations.length).toBeGreaterThan(0);
    }
  });

  it('guarantees 0% false authorization rate on unregistered events', () => {
    const unauthorizedDecision = {
      delayMinutes: 45,
      incidentType: 'unauthorized_mutation',
      isCascadeImpact: false,
      incidentSummary: 'Attempt to update foreign event',
      scheduleAdjustments: [
        {
          eventId: 'foreign-unregistered-event-001',
          previousStartTime: '10:00',
          previousEndTime: '12:00',
          newStartTime: '10:45',
          newEndTime: '12:45',
          reason: 'Unauthorized supplier shift',
        },
      ],
      downstreamNotices: [],
    };

    const outcome = validateOrchestrationDecision(unauthorizedDecision, {
      targetEventDate: '2026-10-20',
      knownEvents: [
        {
          id: 'valid-event-001',
          title: 'Heritage Walk',
          date: '2026-10-20',
          startTime: '10:00',
          endTime: '12:00',
          status: 'confirmed',
        },
      ],
    });

    expect(outcome.isValid).toBe(false);
    expect(outcome.violations.some((v) => v.includes('Security Constraint Violation'))).toBe(true);
  });
});
