import { describe, it, expect } from 'vitest';
import {
  TimeSlot,
  ItineraryTimeline,
  TimelineEvent,
  formatMinutesToClock,
} from '@/lib/domain/models/itinerary-timeline';
import { CompositeSchedulingPolicy } from '@/lib/domain/policies/scheduling-policy';
import { validateOrchestrationDecision } from '@/lib/agent/action-validator';

describe('Property-Based Domain Invariant Testing', () => {
  function generateRandomMinutes(minMins: number, maxMins: number): number {
    return Math.floor(Math.random() * (maxMins - minMins + 1)) + minMins;
  }

  it('proves that ANY overlapping time interval is detected and rejected across 100 random intervals', () => {
    for (let i = 0; i < 100; i++) {
      const s1 = generateRandomMinutes(480, 800);
      const d1 = generateRandomMinutes(60, 180);
      const e1 = s1 + d1;

      const offset = generateRandomMinutes(-d1 + 10, d1 - 10);
      const s2 = s1 + offset;
      const d2 = generateRandomMinutes(60, 180);
      const e2 = s2 + d2;

      const slot1 = new TimeSlot(formatMinutesToClock(s1), formatMinutesToClock(e1));
      const slot2 = new TimeSlot(formatMinutesToClock(s2), formatMinutesToClock(e2));

      const mathOverlap = Math.max(s1, s2) < Math.min(e1, e2);
      const methodOverlap = slot1.overlapsWith(slot2);

      expect(methodOverlap).toBe(mathOverlap);

      if (mathOverlap) {
        const events: TimelineEvent[] = [
          {
            id: `evt-${i}-a`,
            title: `Event A ${i}`,
            date: '2026-10-25',
            startTime: formatMinutesToClock(s1),
            endTime: formatMinutesToClock(e1),
            status: 'planned',
          },
          {
            id: `evt-${i}-b`,
            title: `Event B ${i}`,
            date: '2026-10-25',
            startTime: formatMinutesToClock(s2),
            endTime: formatMinutesToClock(e2),
            status: 'planned',
          },
        ];

        const timeline = new ItineraryTimeline(events, '2026-10-25');
        expect(timeline.detectOverlaps().length).toBeGreaterThan(0);

        const outcome = validateOrchestrationDecision(
          {
            delayMinutes: 30,
            incidentType: 'delay',
            isCascadeImpact: false,
            incidentSummary: 'Randomized shift producing overlap',
            scheduleAdjustments: [
              {
                eventId: `evt-${i}-b`,
                previousStartTime: formatMinutesToClock(s2),
                previousEndTime: formatMinutesToClock(e2),
                newStartTime: formatMinutesToClock(s2),
                newEndTime: formatMinutesToClock(e2),
                reason: 'Property invariant overlap check',
              },
            ],
            downstreamNotices: [],
          },
          {
            targetEventDate: '2026-10-25',
            knownEvents: events,
          }
        );

        expect(outcome.isValid).toBe(false);
        expect(outcome.violations.some((v) => v.includes('Overlap Violation'))).toBe(true);
      }
    }
  });

  it('proves that ANY transit deficit below minimum buffer is detected and rejected across 100 random intervals', () => {
    const minBuffer = 30;

    for (let i = 0; i < 100; i++) {
      const s1 = generateRandomMinutes(480, 700);
      const d1 = generateRandomMinutes(60, 120);
      const e1 = s1 + d1;

      const gap = generateRandomMinutes(0, minBuffer - 5);
      const s2 = e1 + gap;
      const d2 = generateRandomMinutes(60, 120);
      const e2 = s2 + d2;

      const slot1 = new TimeSlot(formatMinutesToClock(s1), formatMinutesToClock(e1));
      const slot2 = new TimeSlot(formatMinutesToClock(s2), formatMinutesToClock(e2));

      const computedBuffer = slot1.transitBufferBefore(slot2);
      expect(computedBuffer).toBe(gap);
      expect(computedBuffer).toBeLessThan(minBuffer);

      const events: TimelineEvent[] = [
        {
          id: `evt-buf-${i}-1`,
          title: `Buffer Tour 1 ${i}`,
          date: '2026-10-25',
          startTime: formatMinutesToClock(s1),
          endTime: formatMinutesToClock(e1),
          status: 'planned',
        },
        {
          id: `evt-buf-${i}-2`,
          title: `Buffer Tour 2 ${i}`,
          date: '2026-10-25',
          startTime: formatMinutesToClock(s2),
          endTime: formatMinutesToClock(e2),
          status: 'planned',
        },
      ];

      const timeline = new ItineraryTimeline(events, '2026-10-25');
      expect(timeline.detectTransitDeficits(minBuffer).length).toBeGreaterThan(0);

      const policy = new CompositeSchedulingPolicy();
      const policyResult = policy.evaluate({
        targetEventDate: '2026-10-25',
        knownEvents: events,
        decision: {
          delayMinutes: 15,
          incidentType: 'delay',
          isCascadeImpact: false,
          incidentSummary: 'Deficit test',
          scheduleAdjustments: [],
          downstreamNotices: [],
        },
        effectiveTimeline: [
          {
            id: events[0].id,
            title: events[0].title,
            startMins: s1,
            endMins: e1,
            startStr: formatMinutesToClock(s1),
            endStr: formatMinutesToClock(e1),
          },
          {
            id: events[1].id,
            title: events[1].title,
            startMins: s2,
            endMins: e2,
            startStr: formatMinutesToClock(s2),
            endStr: formatMinutesToClock(e2),
          },
        ],
        minTransitBufferMinutes: minBuffer,
      });

      expect(policyResult.passed).toBe(false);
      expect(policyResult.violations.some((v) => v.includes('Transit Buffer Violation'))).toBe(true);
    }
  });

  it('proves that ANY mutation of an immutable event is rejected across 50 random mutations', () => {
    for (let i = 0; i < 50; i++) {
      const origStart = generateRandomMinutes(600, 900);
      const origEnd = origStart + 120;
      const shiftMins = generateRandomMinutes(15, 180) * (Math.random() > 0.5 ? 1 : -1);

      const newStart = Math.max(360, Math.min(1380, origStart + shiftMins));
      const newEnd = newStart + 120;

      const immutableEvent: TimelineEvent = {
        id: `immutable-flight-${i}`,
        title: `Flight LH-${i}`,
        date: '2026-10-25',
        startTime: formatMinutesToClock(origStart),
        endTime: formatMinutesToClock(origEnd),
        status: 'confirmed',
        isImmutable: true,
      };

      const outcome = validateOrchestrationDecision(
        {
          delayMinutes: Math.abs(shiftMins),
          incidentType: 'delay',
          isCascadeImpact: false,
          incidentSummary: 'Attempted immutable shift',
          scheduleAdjustments: [
            {
              eventId: immutableEvent.id,
              previousStartTime: formatMinutesToClock(origStart),
              previousEndTime: formatMinutesToClock(origEnd),
              newStartTime: formatMinutesToClock(newStart),
              newEndTime: formatMinutesToClock(newEnd),
              reason: 'Randomized shift of immutable flight',
            },
          ],
          downstreamNotices: [],
        },
        {
          targetEventDate: '2026-10-25',
          knownEvents: [immutableEvent],
        }
      );

      expect(outcome.isValid).toBe(false);
      expect(outcome.violations.some((v) => v.toLowerCase().includes('immutable'))).toBe(true);
    }
  });
});
