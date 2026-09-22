import {
  TimelineEvent,
  EffectiveTimelineEvent,
  parseClockToMinutes,
} from '../models/itinerary-timeline';
import type { OrchestrationDecision, ScheduleAdjustment } from '@/lib/whatsapp/types';

export interface PolicyEvaluationContext {
  targetEventDate: string;
  knownEvents: TimelineEvent[];
  decision: OrchestrationDecision;
  effectiveTimeline: EffectiveTimelineEvent[];
  maxAllowedShiftMinutes?: number;
  minTransitBufferMinutes?: number;
  operationalDayStartMinutes?: number;
  operationalDayEndMinutes?: number;
}

export interface PolicyResult {
  passed: boolean;
  violations: string[];
}

export interface PolicyRule<TContext = PolicyEvaluationContext> {
  readonly id: string;
  readonly name: string;
  evaluate(context: TContext): PolicyResult;
}

export type SchedulingPolicy = PolicyRule<PolicyEvaluationContext>;

export class PolicyCombinator {
  static and(ruleA: PolicyRule, ruleB: PolicyRule): PolicyRule {
    return {
      id: `${ruleA.id}_AND_${ruleB.id}`,
      name: `${ruleA.name} AND ${ruleB.name}`,
      evaluate: (ctx) => {
        const resA = ruleA.evaluate(ctx);
        const resB = ruleB.evaluate(ctx);
        return {
          passed: resA.passed && resB.passed,
          violations: [...resA.violations, ...resB.violations],
        };
      },
    };
  }

  static or(ruleA: PolicyRule, ruleB: PolicyRule): PolicyRule {
    return {
      id: `${ruleA.id}_OR_${ruleB.id}`,
      name: `${ruleA.name} OR ${ruleB.name}`,
      evaluate: (ctx) => {
        const resA = ruleA.evaluate(ctx);
        if (resA.passed) {
          return { passed: true, violations: [] };
        }
        const resB = ruleB.evaluate(ctx);
        if (resB.passed) {
          return { passed: true, violations: [] };
        }
        return {
          passed: false,
          violations: [...resA.violations, ...resB.violations],
        };
      },
    };
  }

  static every(rules: PolicyRule[]): PolicyRule {
    return {
      id: 'COMPOSITE_EVERY',
      name: 'Composite Conjunction Rule',
      evaluate: (ctx) => {
        const violations: string[] = [];
        const passed = rules.every((rule) => {
          const res = rule.evaluate(ctx);
          if (!res.passed) {
            violations.push(...res.violations);
          }
          return res.passed;
        });
        return { passed: violations.length === 0, violations };
      },
    };
  }
}

export class DurationBoundsPolicy implements PolicyRule {
  readonly id = 'DURATION_BOUNDS';
  readonly name = 'Duration Bounds Policy';

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    const knownMap = new Map(context.knownEvents.map((e) => [e.id, e]));

    for (const adj of context.decision.scheduleAdjustments) {
      const known = knownMap.get(adj.eventId);
      if (!known) {
        continue;
      }

      const startMins = parseClockToMinutes(adj.newStartTime);
      const endMins = parseClockToMinutes(adj.newEndTime);

      if (startMins >= endMins) {
        violations.push(
          `Time Order Inversion: Event "${known.title}" start time (${adj.newStartTime}) must be strictly before end time (${adj.newEndTime}).`
        );
      }

      const duration = endMins - startMins;
      if (duration < 15 || duration > 480) {
        violations.push(
          `Duration Bounds Violation: Event "${known.title}" duration (${duration} mins) must be between 15m and 8 hours.`
        );
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class ImmutableEventPolicy implements PolicyRule {
  readonly id = 'IMMUTABLE_BOOKING';
  readonly name = 'Immutable Booking Policy';

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    const knownMap = new Map(context.knownEvents.map((e) => [e.id, e]));

    for (const adj of context.decision.scheduleAdjustments) {
      const known = knownMap.get(adj.eventId);
      if (known && known.isImmutable) {
        violations.push(
          `Safety Constraint Violation: Event "${known.title}" (${adj.eventId}) is designated immutable and cannot be automatically rescheduled.`
        );
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class OperationalWindowPolicy implements PolicyRule {
  readonly id = 'OPERATIONAL_WINDOW';
  readonly name = 'Operational Window Policy';

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    const knownMap = new Map(context.knownEvents.map((e) => [e.id, e]));
    const dayStart = context.operationalDayStartMinutes ?? 360;
    const dayEnd = context.operationalDayEndMinutes ?? 1425;

    for (const adj of context.decision.scheduleAdjustments) {
      const known = knownMap.get(adj.eventId);
      if (!known) {
        continue;
      }

      const isNightActivity = /stargazing|نجوم|سماء|فلك|مخيم ليلي/i.test(known.title);
      if (isNightActivity) {
        continue;
      }

      const startMins = parseClockToMinutes(adj.newStartTime);
      const endMins = parseClockToMinutes(adj.newEndTime);

      if (startMins < dayStart || endMins > dayEnd) {
        violations.push(
          `Operational Window Violation: Event "${known.title}" (${adj.newStartTime} - ${adj.newEndTime}) falls outside the operational window (06:00 - 23:45).`
        );
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class ShiftMagnitudePolicy implements PolicyRule {
  readonly id = 'SHIFT_MAGNITUDE';
  readonly name = 'Shift Magnitude Ceiling Policy';

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    const knownMap = new Map(context.knownEvents.map((e) => [e.id, e]));
    const maxShift = context.maxAllowedShiftMinutes ?? 240;

    for (const adj of context.decision.scheduleAdjustments) {
      const known = knownMap.get(adj.eventId);
      if (!known) {
        continue;
      }

      const startMins = parseClockToMinutes(adj.newStartTime);
      const prevStartMins = parseClockToMinutes(adj.previousStartTime);
      const shiftMagnitude = Math.abs(startMins - prevStartMins);

      if (shiftMagnitude > maxShift) {
        violations.push(
          `Excessive Shift Violation: Event "${known.title}" shifted by ${shiftMagnitude} mins, which exceeds the autonomous threshold of ${maxShift} mins.`
        );
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class OverlapPolicy implements PolicyRule {
  readonly id = 'SCHEDULE_OVERLAP';
  readonly name = 'Schedule Overlap Prevention Policy';

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    const timeline = context.effectiveTimeline;

    for (let i = 0; i < timeline.length - 1; i++) {
      const current = timeline[i];
      const next = timeline[i + 1];

      if (current.endMins > next.startMins) {
        violations.push(
          `Schedule Overlap Violation: Event "${current.title}" (${current.startStr} - ${current.endStr}) overlaps with "${next.title}" (${next.startStr} - ${next.endStr}).`
        );
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class TransitBufferPolicy implements PolicyRule {
  readonly id = 'TRANSIT_BUFFER';
  readonly name = 'Transit Buffer Preservation Policy';

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    const timeline = context.effectiveTimeline;
    const minBuffer = context.minTransitBufferMinutes ?? 30;

    for (let i = 0; i < timeline.length - 1; i++) {
      const current = timeline[i];
      const next = timeline[i + 1];

      if (current.endMins <= next.startMins) {
        const gap = next.startMins - current.endMins;
        if (gap < minBuffer) {
          violations.push(
            `Transit Buffer Violation: Insufficient transit buffer between "${current.title}" (ends ${current.endStr}) and "${next.title}" (starts ${next.startStr}). Required: ${minBuffer}m, available: ${gap}m.`
          );
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class SchedulingPolicyEngine {
  constructor(private readonly rules: PolicyRule[]) {}

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];
    this.rules.every((rule) => {
      const result = rule.evaluate(context);
      if (!result.passed) {
        violations.push(...result.violations);
      }
      return true;
    });

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}

export class SchedulingPolicyEngineBuilder {
  private readonly rules: PolicyRule[] = [];

  withRule(rule: PolicyRule): this {
    this.rules.push(rule);
    return this;
  }

  withDefaultRules(): this {
    this.rules.push(
      new DurationBoundsPolicy(),
      new ImmutableEventPolicy(),
      new OperationalWindowPolicy(),
      new ShiftMagnitudePolicy(),
      new OverlapPolicy(),
      new TransitBufferPolicy()
    );
    return this;
  }

  build(): SchedulingPolicyEngine {
    if (this.rules.length === 0) {
      this.withDefaultRules();
    }
    return new SchedulingPolicyEngine(this.rules);
  }
}

export class CompositeSchedulingPolicy implements SchedulingPolicy {
  readonly id = 'COMPOSITE_SCHEDULING_ENGINE';
  readonly name = 'Composite Scheduling Engine';
  private readonly engine: SchedulingPolicyEngine;

  constructor(policies?: PolicyRule[]) {
    if (policies && policies.length > 0) {
      this.engine = new SchedulingPolicyEngine(policies);
    } else {
      this.engine = new SchedulingPolicyEngineBuilder().withDefaultRules().build();
    }
  }

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    return this.engine.evaluate(context);
  }
}
