'use client';

import { useState, useEffect } from 'react';
import {
  Clock,
  MapPin,
  CheckCircle2,
  Circle,
  XCircle,
  AlertTriangle,
  Trash2,
  GripVertical,
  Pencil,
  Check,
  X,
  Calendar,
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Skeleton } from '@/components/ui/Skeleton';
import ar from '@/lib/i18n/ar';
import { formatArabicDateHeading } from '@/lib/i18n/date';
import type { ItineraryEvent } from '@/types/itinerary';

interface TimelineViewProps {
  events: ItineraryEvent[];
  isLoading?: boolean;
  onRemoveEvent?: (eventId: string) => void;
  onReorderEvents?: (sourceEventId: string, targetEventId: string) => void;
  onUpdateEventTime?: (
    eventId: string,
    startTime: string,
    endTime: string,
    eventDate?: string
  ) => void;
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
  onReorderEvents,
  onUpdateEventTime,
}: TimelineViewProps) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);

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
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-bold text-gray-900">{ar.timeline.title}</h2>
          <span className="text-[11px] font-semibold text-violet-700 bg-violet-50 px-2 py-0.5 rounded-full border border-violet-200">
            يدعم السحب والإفلات وتعديل المواعيد ⏱️
          </span>
        </div>
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
                isDragging={draggedId === event.id}
                isDragOver={dragOverId === event.id}
                onDragStart={() => setDraggedId(event.id)}
                onDragOver={(e) => {
                  e.preventDefault();
                  if (dragOverId !== event.id) setDragOverId(event.id);
                }}
                onDragLeave={() => {
                  if (dragOverId === event.id) setDragOverId(null);
                }}
                onDrop={() => {
                  if (draggedId && draggedId !== event.id) {
                    onReorderEvents?.(draggedId, event.id);
                  }
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                onDragEnd={() => {
                  setDraggedId(null);
                  setDragOverId(null);
                }}
                onRemove={onRemoveEvent ? () => onRemoveEvent(event.id) : undefined}
                onUpdateEventTime={onUpdateEventTime}
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
  isDragging = false,
  isDragOver = false,
  onDragStart,
  onDragOver,
  onDragLeave,
  onDrop,
  onDragEnd,
  onRemove,
  onUpdateEventTime,
}: {
  event: ItineraryEvent;
  isDragging?: boolean;
  isDragOver?: boolean;
  onDragStart?: () => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: () => void;
  onDrop?: () => void;
  onDragEnd?: () => void;
  onRemove?: () => void;
  onUpdateEventTime?: (
    eventId: string,
    startTime: string,
    endTime: string,
    eventDate?: string
  ) => void;
}) {
  const [isEditingTime, setIsEditingTime] = useState(false);
  const [startTime, setStartTime] = useState(event.startTime);
  const [endTime, setEndTime] = useState(event.endTime);
  const [eventDate, setEventDate] = useState(event.eventDate);

  useEffect(() => {
    setStartTime(event.startTime);
    setEndTime(event.endTime);
    setEventDate(event.eventDate);
  }, [event.startTime, event.endTime, event.eventDate]);

  const config = statusConfig[event.status] ?? statusConfig.planned;
  const StatusIcon = config.icon;

  const handleSaveTime = () => {
    if (startTime && endTime) {
      onUpdateEventTime?.(event.id, startTime, endTime, eventDate);
    }
    setIsEditingTime(false);
  };

  const handleCancelTime = () => {
    setStartTime(event.startTime);
    setEndTime(event.endTime);
    setEventDate(event.eventDate);
    setIsEditingTime(false);
  };

  return (
    <div
      draggable={!isEditingTime}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      className={`group relative rounded-xl border bg-white p-4.5 transition-all select-none ${
        isDragging
          ? 'opacity-40 border-dashed border-violet-400 shadow-none scale-[0.98]'
          : isDragOver
            ? 'border-violet-500 ring-2 ring-violet-400/50 bg-violet-50/20 shadow-md scale-[1.01]'
            : 'border-gray-100 hover:border-gray-200 hover:shadow-md'
      }`}
    >
      {/* Timeline dot */}
      <div className="absolute -start-[15px] top-5 flex h-[18px] w-[18px] items-center justify-center rounded-full border-2 border-white bg-gray-900 shadow-xs">
        <div className="h-1.5 w-1.5 rounded-full bg-white" />
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {/* Drag Handle Grip Icon */}
            <div
              className="cursor-grab active:cursor-grabbing p-0.5 -ms-1 text-gray-300 hover:text-gray-600 rounded transition-colors"
              title="اسحب الفعالية لتبديل موعدها وترتيبها مع فعالية أخرى"
            >
              <GripVertical className="h-4 w-4" />
            </div>

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

          {/* Time & Location Controls */}
          <div className="mt-3 flex items-center gap-3 text-xs text-gray-400 flex-wrap">
            {isEditingTime ? (
              <div
                className="flex items-center gap-2 flex-wrap bg-violet-50/80 p-1.5 rounded-lg border border-violet-200"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-center gap-1">
                  <Clock className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                  <input
                    type="time"
                    value={startTime}
                    onChange={(e) => setStartTime(e.target.value)}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-mono text-gray-800 focus:border-violet-600 focus:outline-none"
                    title="وقت البدء"
                  />
                  <span className="text-gray-400 text-xs font-bold">–</span>
                  <input
                    type="time"
                    value={endTime}
                    onChange={(e) => setEndTime(e.target.value)}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-mono text-gray-800 focus:border-violet-600 focus:outline-none"
                    title="وقت الانتهاء"
                  />
                </div>

                <div className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5 text-violet-600 shrink-0" />
                  <input
                    type="date"
                    value={eventDate}
                    onChange={(e) => setEventDate(e.target.value)}
                    className="rounded border border-gray-200 bg-white px-1.5 py-0.5 text-xs font-mono text-gray-800 focus:border-violet-600 focus:outline-none"
                    title="تاريخ الفعالية"
                  />
                </div>

                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleSaveTime}
                    className="flex items-center gap-1 rounded bg-emerald-600 hover:bg-emerald-700 text-white px-2 py-0.5 text-xs font-bold transition-colors cursor-pointer"
                    title="حفظ الوقت والتاريخ"
                  >
                    <Check className="h-3 w-3" />
                    <span>حفظ</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleCancelTime}
                    className="rounded p-1 text-gray-500 hover:bg-gray-200 transition-colors cursor-pointer"
                    title="إلغاء"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsEditingTime(true)}
                className="group/time inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1 bg-gray-50 hover:bg-violet-50 hover:text-violet-700 border border-transparent hover:border-violet-200 transition-all cursor-pointer text-xs text-gray-500 font-medium"
                title="انقر لتعديل الوقت والتاريخ بالساعات والدقائق"
              >
                <Clock className="h-3.5 w-3.5 text-gray-400 group-hover/time:text-violet-600" />
                <span className="font-mono">{event.startTime} – {event.endTime}</span>
                <Pencil className="h-2.5 w-2.5 opacity-0 group-hover/time:opacity-100 text-violet-500 transition-opacity" />
              </button>
            )}

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

      {event.status === 'escalated' && event.escalationReason && (
        <div className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 p-2.5 border border-red-200/80">
          <AlertTriangle className="h-4 w-4 text-red-600 shrink-0 mt-0.5" />
          <div className="text-xs">
            <span className="font-bold text-red-900">بلاغ التأخير/الطارئ: </span>
            <span className="font-medium text-red-800 italic">"{event.escalationReason}"</span>
          </div>
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
