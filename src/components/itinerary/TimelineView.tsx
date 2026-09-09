'use client';

import { Clock, MapPin, CheckCircle2, Circle, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import type { ItineraryEvent } from '@/types/itinerary';

interface TimelineViewProps {
  events: ItineraryEvent[];
  isLoading: boolean;
}

const statusConfig: Record<string, { icon: typeof CheckCircle2; variant: 'success' | 'warning' | 'danger' }> = {
  confirmed: { icon: CheckCircle2, variant: 'success' },
  planned: { icon: Circle, variant: 'warning' },
  cancelled: { icon: XCircle, variant: 'danger' },
};

export function TimelineView({ events, isLoading }: TimelineViewProps) {
  if (isLoading) {
    return <TimelineSkeleton />;
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white p-12">
        <div className="text-center">
          <Clock className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-medium text-gray-500">No events scheduled yet</p>
          <p className="mt-1 text-xs text-gray-400">Add experiences from the Smart Match panel →</p>
        </div>
      </div>
    );
  }

  // Group events by date
  const grouped = groupByDate(events);

  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-900">Itinerary Timeline</h2>
        <span className="text-xs text-gray-400">{events.length} events</span>
      </div>

      {Object.entries(grouped).map(([date, dateEvents]) => (
        <div key={date}>
          {/* Date Header */}
          <div className="mb-3 flex items-center gap-2">
            <div className="h-px flex-1 bg-gray-100" />
            <span className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
              {formatDateHeading(date)}
            </span>
            <div className="h-px flex-1 bg-gray-100" />
          </div>

          {/* Event Cards */}
          <div className="relative space-y-3 pl-6">
            {/* Timeline line */}
            <div className="absolute left-[9px] top-2 bottom-2 w-px bg-gray-200" />

            {dateEvents.map((event) => (
              <EventCard key={event.id} event={event} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Event Card ──────────────────────────────────────────────

function EventCard({ event }: { event: ItineraryEvent }) {
  const config = statusConfig[event.status] ?? statusConfig.planned;
  const StatusIcon = config.icon;

  return (
    <div className="group relative rounded-xl border border-gray-100 bg-white p-4 transition-shadow hover:shadow-md">
      {/* Timeline dot */}
      <div className="absolute -left-6 top-5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-gray-900">
        <div className="h-1.5 w-1.5 rounded-full bg-white" />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-900 truncate">{event.title}</h3>
            <Badge label={event.status} variant={config.variant} size="sm" />
          </div>

          {event.description && (
            <p className="mt-1 text-xs leading-relaxed text-gray-500 line-clamp-2">
              {event.description}
            </p>
          )}

          <div className="mt-2.5 flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {event.startTime} – {event.endTime}
            </span>
            {event.provider && (
              <span className="flex items-center gap-1">
                <MapPin className="h-3 w-3" />
                {event.provider.city}
              </span>
            )}
          </div>
        </div>

        <StatusIcon className={`mt-1 h-4 w-4 shrink-0 ${
          config.variant === 'success' ? 'text-emerald-500' :
          config.variant === 'danger' ? 'text-red-400' : 'text-gray-300'
        }`} />
      </div>

      {event.provider && (
        <div className="mt-3 flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-2">
          <div className="h-6 w-6 rounded-full bg-gray-200" />
          <span className="text-xs font-medium text-gray-600">{event.provider.name}</span>
          {event.provider.verificationStatus === 'verified' && (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          )}
        </div>
      )}
    </div>
  );
}

// ─── Skeleton ────────────────────────────────────────────────

function TimelineSkeleton() {
  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-16" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="space-y-3">
          <Skeleton className="mx-auto h-3 w-24" />
          <div className="space-y-3 pl-6">
            <Skeleton className="h-28 w-full rounded-xl" />
            <Skeleton className="h-28 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function groupByDate(events: ItineraryEvent[]): Record<string, ItineraryEvent[]> {
  return events.reduce<Record<string, ItineraryEvent[]>>((acc, event) => {
    const date = event.eventDate;
    if (!acc[date]) acc[date] = [];
    acc[date].push(event);
    return acc;
  }, {});
}

function formatDateHeading(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}
