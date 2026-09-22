export interface TimelineEvent {
  id: string;
  title: string;
  date: string;
  startTime: string;
  endTime: string;
  status: string;
  isImmutable?: boolean;
}

export interface EffectiveTimelineEvent {
  id: string;
  title: string;
  startMins: number;
  endMins: number;
  startStr: string;
  endStr: string;
  isImmutable?: boolean;
}

export interface DomainEvent<T = Record<string, unknown>> {
  readonly eventName: string;
  readonly occurredAt: string;
  readonly payload: T;
}

export function parseClockToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map((v) => parseInt(v, 10));
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  return h * 60 + m;
}

export function formatMinutesToClock(totalMinutes: number): string {
  const normalized = Math.max(0, Math.min(1439, totalMinutes));
  const h = Math.floor(normalized / 60);
  const m = normalized % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export class TimeSlot {
  readonly startMinutes: number;
  readonly endMinutes: number;
  readonly startStr: string;
  readonly endStr: string;

  constructor(startStr: string, endStr: string) {
    this.startStr = startStr;
    this.endStr = endStr;
    this.startMinutes = parseClockToMinutes(startStr);
    this.endMinutes = parseClockToMinutes(endStr);
  }

  get durationMinutes(): number {
    return this.endMinutes - this.startMinutes;
  }

  isValidInterval(): boolean {
    return this.startMinutes < this.endMinutes;
  }

  overlapsWith(other: TimeSlot): boolean {
    return this.startMinutes < other.endMinutes && this.endMinutes > other.startMinutes;
  }

  transitBufferBefore(other: TimeSlot): number {
    return other.startMinutes - this.endMinutes;
  }
}

export class ItineraryTimeline {
  private readonly events: TimelineEvent[];
  private readonly targetDate: string;
  private domainEvents: DomainEvent[] = [];

  constructor(events: TimelineEvent[], targetDate: string) {
    this.events = events.map((e) => ({ ...e }));
    this.targetDate = targetDate;
  }

  getEvents(): TimelineEvent[] {
    return [...this.events];
  }

  getOperationalDayEvents(): TimelineEvent[] {
    return this.events.filter((e) => !this.targetDate || e.date === this.targetDate);
  }

  getImmutableEvents(): TimelineEvent[] {
    return this.events.filter((e) => Boolean(e.isImmutable));
  }

  isEventImmutable(eventId: string): boolean {
    const ev = this.events.find((e) => e.id === eventId);
    if (!ev) {
      return false;
    }
    return Boolean(ev.isImmutable) || /flight|طيران|مطار|airport|border|منفذ|قطار|train/i.test(ev.title);
  }

  buildEffectiveTimeline(
    adjustments: Map<string, { newStartTime: string; newEndTime: string }>
  ): EffectiveTimelineEvent[] {
    const dayEvents = this.getOperationalDayEvents();
    const effective: EffectiveTimelineEvent[] = [];

    for (const ev of dayEvents) {
      const adj = adjustments.get(ev.id);
      const startStr = adj ? adj.newStartTime : ev.startTime;
      const endStr = adj ? adj.newEndTime : ev.endTime;
      const startMins = parseClockToMinutes(startStr);
      const endMins = parseClockToMinutes(endStr);

      effective.push({
        id: ev.id,
        title: ev.title,
        startMins,
        endMins,
        startStr,
        endStr,
        isImmutable: this.isEventImmutable(ev.id),
      });
    }

    return effective.sort((a, b) => a.startMins - b.startMins || a.endMins - b.endMins);
  }

  calculateTransitBuffer(earlier: EffectiveTimelineEvent, later: EffectiveTimelineEvent): number {
    return later.startMins - earlier.endMins;
  }

  detectOverlaps(timeline: EffectiveTimelineEvent[]): Array<{ current: EffectiveTimelineEvent; next: EffectiveTimelineEvent }> {
    const overlaps: Array<{ current: EffectiveTimelineEvent; next: EffectiveTimelineEvent }> = [];
    for (let i = 0; i < timeline.length - 1; i++) {
      if (timeline[i].endMins > timeline[i + 1].startMins) {
        overlaps.push({ current: timeline[i], next: timeline[i + 1] });
        this.recordDomainEvent({
          eventName: 'TimelineOverlapDetected',
          occurredAt: new Date().toISOString(),
          payload: {
            currentEventId: timeline[i].id,
            nextEventId: timeline[i + 1].id,
            overlapMinutes: timeline[i].endMins - timeline[i + 1].startMins,
          },
        });
      }
    }
    return overlaps;
  }

  detectTransitDeficits(
    timeline: EffectiveTimelineEvent[],
    minBufferMinutes = 30
  ): Array<{ earlier: EffectiveTimelineEvent; later: EffectiveTimelineEvent; deficitMinutes: number }> {
    const deficits: Array<{ earlier: EffectiveTimelineEvent; later: EffectiveTimelineEvent; deficitMinutes: number }> = [];
    for (let i = 0; i < timeline.length - 1; i++) {
      const current = timeline[i];
      const next = timeline[i + 1];
      if (current.endMins <= next.startMins) {
        const gap = next.startMins - current.endMins;
        if (gap < minBufferMinutes) {
          deficits.push({
            earlier: current,
            later: next,
            deficitMinutes: minBufferMinutes - gap,
          });
          this.recordDomainEvent({
            eventName: 'TransitBufferDeficitDetected',
            occurredAt: new Date().toISOString(),
            payload: {
              earlierEventId: current.id,
              laterEventId: next.id,
              availableGap: gap,
              requiredBuffer: minBufferMinutes,
            },
          });
        }
      }
    }
    return deficits;
  }

  pullDomainEvents(): DomainEvent[] {
    const events = [...this.domainEvents];
    this.domainEvents = [];
    return events;
  }

  private recordDomainEvent(event: DomainEvent): void {
    this.domainEvents.push(event);
  }
}
