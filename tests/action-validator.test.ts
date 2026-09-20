import { describe, it, expect } from 'vitest';
import {
  validateOrchestrationDecision,
  parseTimeToMinutes,
  ValidationContext,
} from '@/lib/agent/action-validator';

describe('Agent Action Boundary & Domain Constraint Validator', () => {
  const mockContext: ValidationContext = {
    targetEventDate: '2026-10-15',
    knownEvents: [
      {
        id: 'event-001',
        title: 'AlUla Old Town Heritage Walk',
        date: '2026-10-15',
        startTime: '09:00',
        endTime: '11:30',
        status: 'planned',
      },
      {
        id: 'event-002',
        title: 'Hegra Sunset Safari',
        date: '2026-10-15',
        startTime: '13:00',
        endTime: '16:00',
        status: 'planned',
      },
      {
        id: 'event-flight',
        title: 'Domestic Flight to Riyadh',
        date: '2026-10-15',
        startTime: '19:00',
        endTime: '20:30',
        status: 'confirmed',
        isImmutable: true,
      },
      {
        id: 'event-day-2',
        title: 'Diriyah Historic Tour',
        date: '2026-10-16',
        startTime: '09:30',
        endTime: '12:00',
        status: 'planned',
      },
    ],
  };

  it('correctly parses time strings to minutes', () => {
    expect(parseTimeToMinutes('00:00')).toBe(0);
    expect(parseTimeToMinutes('06:30')).toBe(390);
    expect(parseTimeToMinutes('14:45')).toBe(885);
    expect(parseTimeToMinutes('23:59')).toBe(1439);
  });

  it('approves compliant schedule adjustments', () => {
    const validDecision = {
      delayMinutes: 60,
      incidentType: 'delay',
      isCascadeImpact: true,
      incidentSummary: 'Delay due to morning road closure, safely cascading Hegra Safari forward.',
      scheduleAdjustments: [
        {
          eventId: 'event-001',
          eventTitle: 'AlUla Old Town Heritage Walk',
          previousStartTime: '09:00',
          previousEndTime: '11:30',
          newStartTime: '10:00',
          newEndTime: '12:30',
          reason: '1 hour road delay',
        },
        {
          eventId: 'event-002',
          eventTitle: 'Hegra Sunset Safari',
          previousStartTime: '13:00',
          previousEndTime: '16:00',
          newStartTime: '13:30',
          newEndTime: '16:30',
          reason: '30 minute cascade adjustment',
        },
      ],
      downstreamNotices: [
        {
          eventId: 'event-002',
          providerName: 'Hegra Safari Team',
          newStartTime: '13:30',
          whatsappMessage: 'السلام عليكم ورحمة الله، نبلغكم بترحيل الموعد إلى 13:30',
        },
      ],
    };

    const result = validateOrchestrationDecision(validDecision, mockContext);
    expect(result.isValid).toBe(true);
    expect(result.requiresHumanEscalation).toBe(false);
    expect(result.violations.length).toBe(0);
  });

  it('rejects inverted time ranges where start >= end', () => {
    const invertedDecision = {
      delayMinutes: 60,
      incidentType: 'delay',
      isCascadeImpact: false,
      incidentSummary: 'Inverted timing test',
      scheduleAdjustments: [
        {
          eventId: 'event-001',
          previousStartTime: '09:00',
          previousEndTime: '11:30',
          newStartTime: '14:00',
          newEndTime: '10:00',
          reason: 'Hallucinated reversed interval',
        },
      ],
      downstreamNotices: [],
    };

    const result = validateOrchestrationDecision(invertedDecision, mockContext);
    expect(result.isValid).toBe(false);
    expect(result.requiresHumanEscalation).toBe(true);
    expect(result.violations.some((v) => v.includes('Time Order Inversion'))).toBe(true);
  });

  it('blocks adjustments targeting unknown event IDs', () => {
    const rogueDecision = {
      delayMinutes: 30,
      incidentType: 'delay',
      isCascadeImpact: false,
      incidentSummary: 'Rogue event id test',
      scheduleAdjustments: [
        {
          eventId: 'fake-rogue-event-999',
          previousStartTime: '09:00',
          previousEndTime: '11:00',
          newStartTime: '10:00',
          newEndTime: '12:00',
          reason: 'Attempted mutation of untracked event',
        },
      ],
      downstreamNotices: [],
    };

    const result = validateOrchestrationDecision(rogueDecision, mockContext);
    expect(result.isValid).toBe(false);
    expect(result.violations.some((v) => v.includes('Security Constraint Violation'))).toBe(true);
  });

  it('blocks rescheduling of immutable events such as flights', () => {
    const flightShiftDecision = {
      delayMinutes: 90,
      incidentType: 'delay',
      isCascadeImpact: true,
      incidentSummary: 'Attempting to shift immutable flight',
      scheduleAdjustments: [
        {
          eventId: 'event-flight',
          previousStartTime: '19:00',
          previousEndTime: '20:30',
          newStartTime: '20:30',
          newEndTime: '22:00',
          reason: 'Attempting to delay booked flight',
        },
      ],
      downstreamNotices: [],
    };

    const result = validateOrchestrationDecision(flightShiftDecision, mockContext);
    expect(result.isValid).toBe(false);
    expect(result.violations.some((v) => v.includes('immutable'))).toBe(true);
  });

  it('blocks cross-day cascade modifications', () => {
    const crossDayDecision = {
      delayMinutes: 120,
      incidentType: 'delay',
      isCascadeImpact: true,
      incidentSummary: 'Attempting cross-day shift',
      scheduleAdjustments: [
        {
          eventId: 'event-day-2',
          previousStartTime: '09:30',
          previousEndTime: '12:00',
          newStartTime: '11:30',
          newEndTime: '14:00',
          reason: 'Erroneously shifting next day tour',
        },
      ],
      downstreamNotices: [],
    };

    const result = validateOrchestrationDecision(crossDayDecision, mockContext);
    expect(result.isValid).toBe(false);
    expect(result.violations.some((v) => v.includes('Cross-Day Cascade Violation'))).toBe(true);
  });
});
