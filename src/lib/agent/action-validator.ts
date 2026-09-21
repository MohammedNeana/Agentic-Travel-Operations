import { z } from 'zod';
import type {
  OrchestrationDecision,
  ScheduleAdjustment,
  DownstreamVendorNotice,
} from '@/lib/whatsapp/types';

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
    title: z.string().min(1),
    message: z.string().min(1),
    translatedSummaryInArabic: z.string().min(1),
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

export interface KnownEventContext {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  isImmutable?: boolean;
}

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
}

export function parseTimeToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map((v) => parseInt(v, 10));
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  return h * 60 + m;
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
    };
  }

  const decision = parsed.data as OrchestrationDecision;
  const maxShift = context.maxAllowedShiftMinutes ?? 240;
  const dayStart = context.operationalDayStartMinutes ?? 360;
  const dayEnd = context.operationalDayEndMinutes ?? 1425;

  const knownMap = new Map<string, KnownEventContext>();
  for (const ev of context.knownEvents) {
    knownMap.set(ev.id, ev);
  }

  for (const adj of decision.scheduleAdjustments) {
    const known = knownMap.get(adj.eventId);
    if (!known) {
      violations.push(`Security Constraint Violation: eventId "${adj.eventId}" does not exist in the active itinerary.`);
      continue;
    }

    if (context.targetEventDate && known.date && known.date !== context.targetEventDate) {
      violations.push(`Cross-Day Cascade Violation: Event "${known.title}" (${adj.eventId}) date is ${known.date}, which does not match target operational day ${context.targetEventDate}.`);
    }

    if (known.isImmutable) {
      violations.push(`Safety Constraint Violation: Event "${known.title}" (${adj.eventId}) is designated immutable and cannot be automatically rescheduled.`);
    }

    const startMins = parseTimeToMinutes(adj.newStartTime);
    const endMins = parseTimeToMinutes(adj.newEndTime);

    if (startMins >= endMins) {
      violations.push(`Time Order Inversion: Event "${known.title}" start time (${adj.newStartTime}) must be strictly before end time (${adj.newEndTime}).`);
    }

    const duration = endMins - startMins;
    if (duration < 15 || duration > 480) {
      violations.push(`Duration Bounds Violation: Event "${known.title}" duration (${duration} mins) must be between 15m and 8 hours.`);
    }

    const isNightActivity = /stargazing|نجوم|سماء|فلك|مخيم ليلي/i.test(known.title);
    if (!isNightActivity) {
      if (startMins < dayStart || endMins > dayEnd) {
        violations.push(`Operational Window Violation: Event "${known.title}" (${adj.newStartTime} - ${adj.newEndTime}) falls outside the operational window (06:00 - 23:45).`);
      }
    }

    const prevStartMins = parseTimeToMinutes(adj.previousStartTime);
    const shiftMagnitude = Math.abs(startMins - prevStartMins);
    if (shiftMagnitude > maxShift) {
      violations.push(`Excessive Shift Violation: Event "${known.title}" shifted by ${shiftMagnitude} mins, which exceeds the autonomous threshold of ${maxShift} mins.`);
    }
  }

  for (const notice of decision.downstreamNotices) {
    const known = knownMap.get(notice.eventId);
    if (!known) {
      violations.push(`Notice Validation Violation: Downstream notice targets unknown eventId "${notice.eventId}".`);
    }
  }

  const minBuffer = context.minTransitBufferMinutes ?? 30;
  const operationalDayEvents = context.knownEvents.filter(
    (e) => !context.targetEventDate || e.date === context.targetEventDate
  );

  const adjustmentMap = new Map<string, ScheduleAdjustment>();
  for (const adj of decision.scheduleAdjustments) {
    adjustmentMap.set(adj.eventId, adj);
  }

  const effectiveDailyTimeline: Array<{
    id: string;
    title: string;
    startMins: number;
    endMins: number;
    startStr: string;
    endStr: string;
  }> = [];

  for (const ev of operationalDayEvents) {
    const adj = adjustmentMap.get(ev.id);
    const startStr = adj ? adj.newStartTime : ev.startTime;
    const endStr = adj ? adj.newEndTime : ev.endTime;
    const startMins = parseTimeToMinutes(startStr);
    const endMins = parseTimeToMinutes(endStr);

    effectiveDailyTimeline.push({
      id: ev.id,
      title: ev.title,
      startMins,
      endMins,
      startStr,
      endStr,
    });
  }

  effectiveDailyTimeline.sort((a, b) => a.startMins - b.startMins || a.endMins - b.endMins);

  for (let i = 0; i < effectiveDailyTimeline.length - 1; i++) {
    const current = effectiveDailyTimeline[i];
    const next = effectiveDailyTimeline[i + 1];

    if (current.endMins > next.startMins) {
      violations.push(
        `Schedule Overlap Violation: Event "${current.title}" (${current.startStr} - ${current.endStr}) overlaps with "${next.title}" (${next.startStr} - ${next.endStr}).`
      );
    } else if (next.startMins - current.endMins < minBuffer) {
      violations.push(
        `Transit Buffer Violation: Insufficient transit buffer between "${current.title}" (ends ${current.endStr}) and "${next.title}" (starts ${next.startStr}). Required: ${minBuffer}m, available: ${next.startMins - current.endMins}m.`
      );
    }
  }

  if (violations.length > 0) {
    return {
      isValid: false,
      violations,
      requiresHumanEscalation: true,
    };
  }

  return {
    isValid: true,
    validatedDecision: decision,
    violations: [],
    requiresHumanEscalation: false,
  };
}
