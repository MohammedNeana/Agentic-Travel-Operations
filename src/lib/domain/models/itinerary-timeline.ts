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

export function parseClockToMinutes(timeStr: string): number {
  const parts = timeStr.split(':').map((v) => parseInt(v, 10));
  const h = isNaN(parts[0]) ? 0 : parts[0];
  const m = isNaN(parts[1]) ? 0 : parts[1];
  return h * 60 + m;
}

export class ItineraryTimeline {
  private readonly events: TimelineEvent[];
  private readonly targetDate: string;

  constructor(events: TimelineEvent[], targetDate: string) {
    this.events = events;
    this.targetDate = targetDate;
  }

  getEvents(): TimelineEvent[] {
    return this.events;
  }

  getOperationalDayEvents(): TimelineEvent[] {
    return this.events.filter((e) => !this.targetDate || e.date === this.targetDate);
  }

  getImmutableEvents(): TimelineEvent[] {
    return this.events.filter((e) => Boolean(e.isImmutable));
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
        isImmutable: ev.isImmutable,
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
      }
    }
    return overlaps;
  }
}
