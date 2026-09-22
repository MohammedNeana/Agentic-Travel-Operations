import { z } from 'zod';
import type {
  OrchestrationDecision,
  ScheduleAdjustment,
  DownstreamVendorNotice,
} from '@/lib/whatsapp/types';
import {
  TimelineEvent,
  ItineraryTimeline,
  parseClockToMinutes,
  DomainEvent,
} from '@/lib/domain/models/itinerary-timeline';
import {
  CompositeSchedulingPolicy,
  PolicyEvaluationContext,
} from '@/lib/domain/policies/scheduling-policy';

export const parseTimeToMinutes = parseClockToMinutes;

export const ScheduleAdjustmentSchema = z.object({
  eventId: z.string().min(1),
  eventTitle: z.string().optional(),
  previousStartTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  previousEndTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  newStartTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  newEndTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  newStatus: z.string().optional(),
  reason: z.string().min(1),
});

export const DownstreamVendorNoticeSchema = z.object({
  eventId: z.string().min(1),
  providerName: z.string().optional(),
  providerPhone: z.string().optional(),
  newStartTime: z.string().regex(/^\d{2}:\d{2}(:\d{2})?$/),
  whatsappMessage: z.string().min(1),
});

export const TravelerNotificationSchema = z
  .object({
    language: z.string().min(1),
    flag: z.string().optional(),
    title: z.string().optional(),
    message: z.string().min(1),
    translatedSummaryInArabic: z.string().optional(),
  })
  .optional();

export const OrchestrationDecisionSchema = z.object({
  delayMinutes: z.number().int().nonnegative().max(1440),
  incidentType: z.string().min(1),
  isCascadeImpact: z.boolean(),
  incidentSummary: z.string().min(1),
  scheduleAdjustments: z.array(ScheduleAdjustmentSchema),
  downstreamNotices: z.array(DownstreamVendorNoticeSchema),
  travelerNotification: TravelerNotificationSchema,
});

export type KnownEventContext = TimelineEvent;

export interface ValidationContext {
  targetEventDate: string;
  knownEvents: KnownEventContext[];
  maxAllowedShiftMinutes?: number;
  minTransitBufferMinutes?: number;
  operationalDayStartMinutes?: number;
  operationalDayEndMinutes?: number;
}

export interface ValidationOutcome {
  isValid: boolean;
  validatedDecision?: OrchestrationDecision;
  violations: string[];
  requiresHumanEscalation: boolean;
  domainEvents?: DomainEvent[];
}

export function validateOrchestrationDecision(
  rawInput: unknown,
  context: ValidationContext
): ValidationOutcome {
  const violations: string[] = [];

  const parsed = OrchestrationDecisionSchema.safeParse(rawInput);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      violations.push(`Schema Error at ${issue.path.join('.')}: ${issue.message}`);
    }
    return {
      isValid: false,
      violations,
      requiresHumanEscalation: true,
      domainEvents: [],
    };
  }

  const decision = parsed.data as OrchestrationDecision;
  const knownMap = new Map<string, KnownEventContext>();
  for (const ev of context.knownEvents) {
    knownMap.set(ev.id, ev);
  }

  for (const adj of decision.scheduleAdjustments) {
    const known = knownMap.get(adj.eventId);
    if (!known) {
      violations.push(
        `Security Constraint Violation: eventId "${adj.eventId}" does not exist in the active itinerary.`
      );
      continue;
    }

    if (context.targetEventDate && known.date && known.date !== context.targetEventDate) {
      violations.push(
        `Cross-Day Cascade Violation: Event "${known.title}" (${adj.eventId}) date is ${known.date}, which does not match target operational day ${context.targetEventDate}.`
      );
    }
  }

  for (const notice of decision.downstreamNotices) {
    const known = knownMap.get(notice.eventId);
    if (!known) {
      violations.push(
        `Notice Validation Violation: Downstream notice targets unknown eventId "${notice.eventId}".`
      );
    }
  }

  const timeline = new ItineraryTimeline(context.knownEvents, context.targetEventDate);
  const adjustmentMap = new Map<string, { newStartTime: string; newEndTime: string }>();
  for (const adj of decision.scheduleAdjustments) {
    adjustmentMap.set(adj.eventId, {
      newStartTime: adj.newStartTime,
      newEndTime: adj.newEndTime,
    });
  }

  const effectiveTimeline = timeline.buildEffectiveTimeline(adjustmentMap);
  const compositePolicy = new CompositeSchedulingPolicy();
  const policyResult = compositePolicy.evaluate({
    targetEventDate: context.targetEventDate,
    knownEvents: context.knownEvents,
    decision,
    effectiveTimeline,
    maxAllowedShiftMinutes: context.maxAllowedShiftMinutes,
    minTransitBufferMinutes: context.minTransitBufferMinutes,
    operationalDayStartMinutes: context.operationalDayStartMinutes,
    operationalDayEndMinutes: context.operationalDayEndMinutes,
  });

  if (!policyResult.passed) {
    violations.push(...policyResult.violations);
  }

  const domainEvents = timeline.pullDomainEvents();

  if (violations.length > 0) {
    return {
      isValid: false,
      violations,
      requiresHumanEscalation: true,
      domainEvents,
    };
  }

  return {
    isValid: true,
    validatedDecision: decision,
    violations: [],
    requiresHumanEscalation: false,
    domainEvents,
  };
}
