'use client';

import { Clock, MapPin, CheckCircle2, Circle, XCircle, AlertTriangle, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import ar from '@/lib/i18n/ar';
import { formatArabicDateHeading } from '@/lib/i18n/date';
import type { ItineraryEvent } from '@/types/itinerary';

interface TimelineViewProps {
  events: ItineraryEvent[];
  isLoading?: boolean;
  onRemoveEvent?: (eventId: string) => void;
}

const statusConfig: Record<string, { icon: typeof CheckCircle2; variant: 'success' | 'warning' | 'danger' }> = {
  confirmed: { icon: CheckCircle2, variant: 'success' },
  planned: { icon: Circle, variant: 'warning' },
  cancelled: { icon: XCircle, variant: 'danger' },
  escalated: { icon: AlertTriangle, variant: 'danger' },
};

export function TimelineView({
  events,
  isLoading = false,
  onRemoveEvent,
}: TimelineViewProps) {
  if (isLoading) {
    return <TimelineSkeleton />;
  }

  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white p-12 shadow-xs">
        <div className="text-center">
          <Clock className="mx-auto h-10 w-10 text-gray-300" />
          <p className="mt-3 text-sm font-semibold text-gray-600">{ar.timeline.noEvents}</p>
          <p className="mt-1 text-xs text-gray-400">{ar.timeline.noEventsCta}</p>
        </div>
      </div>
    );
  }

  // Group events by date
  const grouped = groupByDate(events);

  return (
    <div className="flex-1 space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold text-gray-900">{ar.timeline.title}</h2>
        <span className="text-xs text-gray-400 font-medium">
          {events.length} {ar.timeline.events}
        </span>
      </div>

      {Object.entries(grouped).map(([date, dateEvents]) => (
        <div key={date}>
          {/* Date Header */}
          <div className="mb-3.5 flex items-center gap-3">
            <div className="h-px flex-1 bg-gray-200" />
            <span
              className="text-[11px] font-bold uppercase tracking-wider text-gray-500 bg-gray-50 px-3 py-1 rounded-full border border-gray-100"
              suppressHydrationWarning
            >
              {formatArabicDateHeading(date)}
            </span>
            <div className="h-px flex-1 bg-gray-200" />
          </div>

          {/* Event Cards */}
          <div className="relative space-y-3 ps-6">
            {/* Timeline line */}
            <div className="absolute start-[9px] top-2 bottom-2 w-px bg-gray-200" />

            {dateEvents.map((event) => (
              <EventCard
                key={event.id}
                event={event}
                onRemove={onRemoveEvent ? () => onRemoveEvent(event.id) : undefined}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// ─── Event Card ──────────────────────────────────────────────

function EventCard({
  event,
  onRemove,
}: {
  event: ItineraryEvent;
  onRemove?: () => void;
}) {
  const config = statusConfig[event.status] ?? statusConfig.planned;
  const StatusIcon = config.icon;

  return (
    <div className="group relative rounded-xl border border-gray-100 bg-white p-4.5 transition-all hover:border-gray-200 hover:shadow-md">
      {/* Timeline dot */}
      <div className="absolute -start-[15px] top-5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-gray-900 shadow-xs">
        <div className="h-1.5 w-1.5 rounded-full bg-white" />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-bold text-gray-900 truncate">{event.title}</h3>
            <Badge
              label={ar.status[event.status] ?? event.status}
              variant={config.variant}
              size="sm"
            />
          </div>

          {event.description && (
            <p className="mt-1.5 text-xs leading-relaxed text-gray-600 line-clamp-2">
              {event.description}
            </p>
          )}

          <div className="mt-3 flex items-center gap-4 text-xs text-gray-400">
            <span className="flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5 text-gray-400" />
              <span>
                {event.startTime} – {event.endTime}
              </span>
            </span>
            {event.provider && (
              <span className="flex items-center gap-1.5">
                <MapPin className="h-3.5 w-3.5 text-gray-400" />
                <span>{event.provider.city}</span>
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-1.5">
          <StatusIcon
            className={`h-4 w-4 shrink-0 ${
              config.variant === 'success'
                ? 'text-emerald-500'
                : config.variant === 'danger'
                  ? 'text-red-400'
                  : 'text-amber-500'
            }`}
          />
          {onRemove && (
            <button
              type="button"
              onClick={onRemove}
              className="rounded-lg p-1.5 text-gray-400 opacity-60 hover:opacity-100 hover:bg-red-50 hover:text-red-600 transition-all cursor-pointer"
              title="حذف الفعالية من الجدول"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {event.provider && (
        <div className="mt-3.5 flex items-center gap-2 rounded-lg bg-gray-50/80 px-3 py-2 border border-gray-100">
          <div className="h-6 w-6 rounded-full bg-gray-200 flex items-center justify-center text-[10px] font-bold text-gray-600">
            <span suppressHydrationWarning>{event.provider.name.charAt(0)}</span>
          </div>
          <span className="text-xs font-semibold text-gray-700">{event.provider.name}</span>
          {event.provider.verificationStatus === 'verified' && (
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 ms-auto" />
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
          <Skeleton className="mx-auto h-3 w-28" />
          <div className="space-y-3 ps-6">
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
