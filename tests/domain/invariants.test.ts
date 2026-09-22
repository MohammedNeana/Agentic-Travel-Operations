import { describe, it, expect } from 'vitest';
import {
  ItineraryTimeline,
  parseClockToMinutes,
} from '@/lib/domain/models/itinerary-timeline';
import {
  CompositeSchedulingPolicy,
  TransitBufferPolicy,
  OverlapPolicy,
  ImmutableEventPolicy,
  OperationalWindowPolicy,
  ShiftMagnitudePolicy,
} from '@/lib/domain/policies/scheduling-policy';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';
import type { OrchestrationDecision } from '@/lib/whatsapp/types';

describe('Core Business Invariants Suite', () => {
  const baseEvents = [
    {
      id: 'event-a',
      title: 'Morning Nabataean Oasis Tour',
      date: '2026-11-01',
      startTime: '09:00',
      endTime: '11:00',
      status: 'confirmed',
    },
    {
      id: 'event-b',
      title: 'Afternoon Desert Safari',
      date: '2026-11-01',
      startTime: '12:00',
      endTime: '15:00',
      status: 'confirmed',
    },
    {
      id: 'event-c-flight',
      title: 'Flight SV123 to Jeddah',
      date: '2026-11-01',
      startTime: '18:00',
      endTime: '19:30',
      status: 'confirmed',
      isImmutable: true,
    },
  ];

  it('Invariant 1: Enforces chronology and minimum 30-minute transit buffer between events', () => {
    const timeline = new ItineraryTimeline(baseEvents, '2026-11-01');
    const adjustments = new Map<string, { newStartTime: string; newEndTime: string }>([
      ['event-a', { newStartTime: '09:30', newEndTime: '11:45' }],
    ]);

    const effective = timeline.buildEffectiveTimeline(adjustments);
    const policy = new TransitBufferPolicy();

    const decision: OrchestrationDecision = {
      delayMinutes: 30,
      incidentType: 'delay',
      isCascadeImpact: false,
      incidentSummary: 'Buffer violation test',
      scheduleAdjustments: [
        {
          eventId: 'event-a',
          previousStartTime: '09:00',
          previousEndTime: '11:00',
          newStartTime: '09:30',
          newEndTime: '11:45',
          reason: '30 min delay causes only 15 min buffer before 12:00',
        },
      ],
      downstreamNotices: [],
    };

    const result = policy.evaluate({
      targetEventDate: '2026-11-01',
      knownEvents: baseEvents,
      decision,
      effectiveTimeline: effective,
      minTransitBufferMinutes: 30,
    });

    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes('Transit Buffer Violation'))).toBe(true);
  });

  it('Invariant 2: Flight departure halts cascade and triggers human manager escalation', () => {
    const flightDecision: OrchestrationDecision = {
      delayMinutes: 120,
      incidentType: 'delay',
      isCascadeImpact: true,
      incidentSummary: 'Severe cascade impacting scheduled flight',
      scheduleAdjustments: [
        {
          eventId: 'event-c-flight',
          previousStartTime: '18:00',
          previousEndTime: '19:30',
          newStartTime: '20:00',
          newEndTime: '21:30',
          reason: 'Cascading safari delay into flight slot',
        },
      ],
      downstreamNotices: [],
    };

    const validation = validateOrchestrationDecision(flightDecision, {
      targetEventDate: '2026-11-01',
      knownEvents: baseEvents,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.requiresHumanEscalation).toBe(true);
    expect(validation.violations.some((v) => v.includes('immutable'))).toBe(true);
  });

  it('Invariant 3: Day boundary protection blocks activities ending past 23:45', () => {
    const nightDecision: OrchestrationDecision = {
      delayMinutes: 180,
      incidentType: 'delay',
      isCascadeImpact: false,
      incidentSummary: 'Late shift pushing into midnight',
      scheduleAdjustments: [
        {
          eventId: 'event-b',
          previousStartTime: '12:00',
          previousEndTime: '15:00',
          newStartTime: '21:00',
          newEndTime: '23:55',
          reason: 'Excessive evening push',
        },
      ],
      downstreamNotices: [],
    };

    const validation = validateOrchestrationDecision(nightDecision, {
      targetEventDate: '2026-11-01',
      knownEvents: baseEvents,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.requiresHumanEscalation).toBe(true);
    expect(validation.violations.some((v) => v.includes('Operational Window Violation'))).toBe(true);
  });

  it('Invariant 4: Magnitude ceiling blocks shifts greater than 240 minutes', () => {
    const excessiveShiftDecision: OrchestrationDecision = {
      delayMinutes: 300,
      incidentType: 'delay',
      isCascadeImpact: false,
      incidentSummary: 'Excessive 5-hour shift',
      scheduleAdjustments: [
        {
          eventId: 'event-a',
          previousStartTime: '09:00',
          previousEndTime: '11:00',
          newStartTime: '14:30',
          newEndTime: '16:30',
          reason: '330 minute massive delay',
        },
      ],
      downstreamNotices: [],
    };

    const validation = validateOrchestrationDecision(excessiveShiftDecision, {
      targetEventDate: '2026-11-01',
      knownEvents: baseEvents,
      maxAllowedShiftMinutes: 240,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.requiresHumanEscalation).toBe(true);
    expect(validation.violations.some((v) => v.includes('Excessive Shift Violation'))).toBe(true);
  });

  it('Invariant 5: Downstream notices must strictly reference registered event entities', () => {
    const invalidNoticeDecision: OrchestrationDecision = {
      delayMinutes: 30,
      incidentType: 'delay',
      isCascadeImpact: true,
      incidentSummary: 'Valid shift with phantom notice',
      scheduleAdjustments: [
        {
          eventId: 'event-a',
          previousStartTime: '09:00',
          previousEndTime: '11:00',
          newStartTime: '09:15',
          newEndTime: '11:15',
          reason: 'Minor 15 min shift',
        },
      ],
      downstreamNotices: [
        {
          eventId: 'phantom-unregistered-event-id',
          providerName: 'Unknown Vendor',
          newStartTime: '12:00',
          whatsappMessage: 'Notice to untracked provider',
        },
      ],
    };

    const validation = validateOrchestrationDecision(invalidNoticeDecision, {
      targetEventDate: '2026-11-01',
      knownEvents: baseEvents,
    });

    expect(validation.isValid).toBe(false);
    expect(validation.requiresHumanEscalation).toBe(true);
    expect(validation.violations.some((v) => v.includes('Notice Validation Violation'))).toBe(true);
  });
});
