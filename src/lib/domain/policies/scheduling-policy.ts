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

export interface SchedulingPolicy {
  evaluate(context: PolicyEvaluationContext): PolicyResult;
}

export class DurationBoundsPolicy implements SchedulingPolicy {
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

export class ImmutableEventPolicy implements SchedulingPolicy {
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

export class OperationalWindowPolicy implements SchedulingPolicy {
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

export class ShiftMagnitudePolicy implements SchedulingPolicy {
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

export class OverlapPolicy implements SchedulingPolicy {
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

export class TransitBufferPolicy implements SchedulingPolicy {
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

export class CompositeSchedulingPolicy implements SchedulingPolicy {
  private readonly policies: SchedulingPolicy[];

  constructor(policies?: SchedulingPolicy[]) {
    this.policies = policies || [
      new DurationBoundsPolicy(),
      new ImmutableEventPolicy(),
      new OperationalWindowPolicy(),
      new ShiftMagnitudePolicy(),
      new OverlapPolicy(),
      new TransitBufferPolicy(),
    ];
  }

  evaluate(context: PolicyEvaluationContext): PolicyResult {
    const violations: string[] = [];

    for (const policy of this.policies) {
      const res = policy.evaluate(context);
      if (!res.passed) {
        violations.push(...res.violations);
      }
    }

    return {
      passed: violations.length === 0,
      violations,
    };
  }
}
