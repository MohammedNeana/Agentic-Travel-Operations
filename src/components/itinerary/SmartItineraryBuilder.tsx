'use client';

import { useState, useEffect } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { TravelerProfileSidebar, defaultArabicTravelerProfile } from '@/components/itinerary/TravelerProfileSidebar';
import { TimelineView } from '@/components/itinerary/TimelineView';
import { SmartMatchPanel } from '@/components/itinerary/SmartMatchPanel';
import { WarningSection } from '@/components/itinerary/WarningSection';
import ar from '@/lib/i18n/ar';
import { formatArabicDateRange } from '@/lib/i18n/date';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { detectScheduleWarnings } from '@/lib/itinerary/warnings';
import type {
  TravelerProfile,
  Itinerary,
  ItineraryEvent,
  ExperienceProvider,
  SmartMatchRecommendation,
  ScheduleWarning,
} from '@/types/itinerary';

interface SmartItineraryBuilderProps {
  initialItinerary?: Itinerary | null;
  initialRecommendations?: SmartMatchRecommendation[];
  initialWarnings?: ScheduleWarning[];
  initialProfile?: TravelerProfile | null;
  initialTravelers?: TravelerProfile[];
  isLoading?: boolean;
}

export function SmartItineraryBuilder({
  initialItinerary,
  initialRecommendations = [],
  initialWarnings = [],
  initialProfile = defaultArabicTravelerProfile,
  initialTravelers = [],
  isLoading = false,
}: SmartItineraryBuilderProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [profile, setProfile] = useState<TravelerProfile | null>(initialProfile);
  const [travelers] = useState<TravelerProfile[]>(initialTravelers);
  const [itinerary, setItinerary] = useState<Itinerary | null>(initialItinerary ?? null);
  const [itineraryEvents, setItineraryEvents] = useState<ItineraryEvent[]>(initialItinerary?.events ?? []);
  const [recommendations, setRecommendations] = useState<SmartMatchRecommendation[]>(initialRecommendations);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>(initialWarnings);
  const [isReMatching, setIsReMatching] = useState(false);
  const [isLoadingItinerary, setIsLoadingItinerary] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveFeedbackText, setSaveFeedbackText] = useState('تم الحفظ بنجاح');
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

  useEffect(() => {
    setIsMounted(true);
  }, []);

  // Filter out external Chrome extension unhandled rejection noise from Next.js terminal logs
  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = String(event.reason?.stack || event.reason || '');
      if (reasonStr.includes('chrome-extension://')) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  // Real-time WebSocket subscription via Supabase Realtime for instant event updates
  useEffect(() => {
    if (!profile?.id) return;

    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`realtime-itinerary-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_events' },
        async () => {
          // If the user has local unsaved edits, do not overwrite them automatically
          if (hasUnsavedChanges) return;

          try {
            const res = await fetch(`/api/itineraries?traveler_id=${profile.id}`);
            const data = await res.json();
            if (data.success && data.itinerary) {
              setItinerary(data.itinerary);
              const events = data.itinerary.events || [];
              setItineraryEvents(events);
              setWarnings(detectScheduleWarnings(events, profile));
            }
          } catch (err) {
            console.error('Failed to sync itinerary on realtime update:', err);
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, hasUnsavedChanges]);

  const handleSelectTraveler = async (newProfile: TravelerProfile) => {
    setProfile(newProfile);
    setIsReMatching(true);
    setIsLoadingItinerary(true);
    setHasUnsavedChanges(false);
    setSaveSuccess(false);

    try {
      // Fetch recommendations and traveler-specific itinerary in parallel
      const [matchRes, itinRes] = await Promise.all([
        fetch('/api/providers/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interests: newProfile.interests,
            tenant_id: newProfile.tenantId || itinerary?.tenantId || 'a1b2c3d4-0001-4000-8000-000000000001',
          }),
        }),
        fetch(`/api/itineraries?traveler_id=${newProfile.id}`),
      ]);

      const [matchData, itinData] = await Promise.all([
        matchRes.json(),
        itinRes.json(),
      ]);

      if (matchData.success && Array.isArray(matchData.recommendations)) {
        setRecommendations(matchData.recommendations);
      }
      if (itinData.success && itinData.itinerary) {
        setItinerary(itinData.itinerary);
        const newEvents = itinData.itinerary.events || [];
        setItineraryEvents(newEvents);
        setWarnings(detectScheduleWarnings(newEvents, newProfile));
      }
    } catch (err) {
      console.error('Failed to switch traveler:', err);
    } finally {
      setIsReMatching(false);
      setIsLoadingItinerary(false);
    }
  };

  const handleReMatch = async () => {
    setIsReMatching(true);
    try {
      const res = await fetch('/api/providers/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interests: profile?.interests,
          tenant_id: profile?.tenantId || itinerary?.tenantId || 'a1b2c3d4-0001-4000-8000-000000000001',
        }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.recommendations)) {
        setRecommendations(data.recommendations);
      }
    } catch (err) {
      console.error('Failed to rematch providers:', err);
    } finally {
      setIsReMatching(false);
    }
  };

  // Add event from Smart Match recommendations to timeline with smart non-conflicting time slotting
  const handleAddEvent = (provider: ExperienceProvider) => {
    const lastEvent = itineraryEvents[itineraryEvents.length - 1];
    const eventDate = lastEvent?.eventDate || itinerary?.startDate || profile?.arrivalDate || '2026-10-18';
    const dayEvents = itineraryEvents.filter((e) => e.eventDate === eventDate);
    const sortOrder = dayEvents.length + 1;

    // Smart automatic slotting: find latest endTime on this day and add next slot with buffer
    let smartStart = '09:00';
    let smartEnd = '12:00';

    if (dayEvents.length > 0) {
      const sortedByEnd = [...dayEvents].sort((a, b) => b.endTime.localeCompare(a.endTime));
      const latestEnd = sortedByEnd[0].endTime; // e.g. "13:00"
      const [hStr, mStr] = latestEnd.split(':');
      const latestH = parseInt(hStr, 10) || 12;
      const latestM = mStr || '00';

      const nextStartH = latestH + 1; // 1-hour transit / buffer
      const nextEndH = nextStartH + 3; // 3-hour duration

      if (nextEndH <= 22) {
        smartStart = `${String(nextStartH).padStart(2, '0')}:${latestM}`;
        smartEnd = `${String(nextEndH).padStart(2, '0')}:${latestM}`;
      } else {
        smartStart = '19:00';
        smartEnd = '22:00';
      }
    }

    const newEvent: ItineraryEvent = {
      id: crypto.randomUUID(),
      tenantId: itinerary?.tenantId || profile?.tenantId || 'a1b2c3d4-0001-4000-8000-000000000001',
      itineraryId: itinerary?.id || 'c1b2c3d4-0001-4000-8000-000000000001',
      experienceProviderId: provider.id,
      title: provider.name,
      description: `تجربة ${provider.experienceType} مميزة في ${provider.city} مع مزود محلي معتمد.`,
      eventDate,
      startTime: smartStart,
      endTime: smartEnd,
      sortOrder,
      status: 'planned',
      provider,
    };

    const updated = [...itineraryEvents, newEvent];
    updated.sort((a, b) => {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });

    setItineraryEvents(updated);
    setWarnings(detectScheduleWarnings(updated, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  // Swap / Reorder events via Drag and Drop (swapping time slots and positions)
  const handleReorderEvents = (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;

    const sourceIdx = itineraryEvents.findIndex((e) => e.id === sourceId);
    const targetIdx = itineraryEvents.findIndex((e) => e.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const sourceEvent = itineraryEvents[sourceIdx];
    const targetEvent = itineraryEvents[targetIdx];

    // Swap time slots and dates between source and target
    const updatedSource: ItineraryEvent = {
      ...sourceEvent,
      eventDate: targetEvent.eventDate,
      startTime: targetEvent.startTime,
      endTime: targetEvent.endTime,
      sortOrder: targetEvent.sortOrder,
    };

    const updatedTarget: ItineraryEvent = {
      ...targetEvent,
      eventDate: sourceEvent.eventDate,
      startTime: sourceEvent.startTime,
      endTime: sourceEvent.endTime,
      sortOrder: sourceEvent.sortOrder,
    };

    const newEvents = [...itineraryEvents];
    newEvents[sourceIdx] = updatedSource;
    newEvents[targetIdx] = updatedTarget;

    // Sort by date then startTime
    newEvents.sort((a, b) => {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });

    setItineraryEvents(newEvents);
    setWarnings(detectScheduleWarnings(newEvents, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  // Manually update specific event hours and date
  const handleUpdateEventTime = (
    eventId: string,
    startTime: string,
    endTime: string,
    eventDate?: string
  ) => {
    const newEvents = itineraryEvents.map((ev) => {
      if (ev.id !== eventId) return ev;
      return {
        ...ev,
        startTime,
        endTime,
        eventDate: eventDate || ev.eventDate,
      };
    });

    // Sort by date then startTime
    newEvents.sort((a, b) => {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });

    setItineraryEvents(newEvents);
    setWarnings(detectScheduleWarnings(newEvents, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  // Remove event from timeline
  const handleRemoveEvent = (eventId: string) => {
    const updated = itineraryEvents.filter((e) => e.id !== eventId);
    setItineraryEvents(updated);
    setWarnings(detectScheduleWarnings(updated, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  };

  // Sync current itinerary events to Supabase
  const handleSaveItinerary = async () => {
    if (!itinerary?.id) return;
    setIsSaving(true);
    setSaveSuccess(false);

    try {
      const res = await fetch('/api/itineraries/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itineraryId: itinerary.id,
          tenantId: itinerary.tenantId,
          events: itineraryEvents,
          travelerNationality: profile?.nationality,
          groupSize: profile?.groupSize,
          dietaryRestrictions: profile?.dietaryRestrictions,
          mobilityNotes: profile?.mobilityNotes,
        }),
      });

      const data = await res.json();
      if (data.success) {
        setHasUnsavedChanges(false);
        const sentNotifs = (data.outboundNotifications || []).filter(
          (n: { status: string }) => n.status === 'sent'
        );
        if (sentNotifs.length > 0) {
          setSaveFeedbackText(`تم الحفظ وإرسال إشعار واتساب للمزود 📱`);
        } else {
          setSaveFeedbackText('تم الحفظ بنجاح');
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4500);
      } else {
        alert(`فشل الحفظ: ${data.error || 'حدث خطأ غير متوقع'}`);
      }
    } catch (err) {
      console.error('Failed to save itinerary to Supabase:', err);
      alert('تعذر الاتصال بالخادم لحفظ التغييرات.');
    } finally {
      setIsSaving(false);
    }
  };

  if (!isMounted) {
    return (
      <div className="min-h-screen bg-gray-50/50 flex items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-gray-900 border-t-transparent" />
          <p className="text-xs font-semibold text-gray-500">جارٍ التحميل...</p>
        </div>
      </div>
    );
  }

  const activeItinerary = itinerary;

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Top Bar */}
      <header className="sticky top-[57px] z-20 border-b border-gray-100 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold tracking-tight text-gray-900">
                {ar.header.title}
              </h1>
              {activeItinerary && (
                <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-0.5 text-xs font-semibold text-gray-600">
                  {ar.status[activeItinerary.status] ?? activeItinerary.status}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-gray-500 font-medium" suppressHydrationWarning>
              {activeItinerary
                ? `${activeItinerary.title} · ${formatArabicDateRange(activeItinerary.startDate, activeItinerary.endDate)}`
                : profile
                  ? `${profile.name} · ${formatArabicDateRange(profile.arrivalDate, profile.departureDate)}`
                  : ar.header.loadingTraveler}
            </p>
          </div>

          <div className="flex items-center gap-3">
            {hasUnsavedChanges && (
              <span className="hidden sm:inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50 border border-amber-200/80 px-2.5 py-1 rounded-full">
                <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
                تغييرات غير محفوظة
              </span>
            )}
            <button
              type="button"
              onClick={handleSaveItinerary}
              disabled={isSaving}
              className={`inline-flex items-center gap-2 rounded-xl px-4.5 py-2.5 text-xs font-bold text-white shadow-xs transition-all cursor-pointer ${
                saveSuccess
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-200'
                  : hasUnsavedChanges
                    ? 'bg-violet-600 hover:bg-violet-700 shadow-md'
                    : 'bg-gray-900 hover:bg-gray-800 hover:shadow-md'
              } disabled:opacity-60`}
            >
              {isSaving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  <span>جارٍ الحفظ...</span>
                </>
              ) : saveSuccess ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  <span>{saveFeedbackText}</span>
                </>
              ) : (
                <span>{ar.header.saveItinerary}</span>
              )}
            </button>
          </div>
        </div>
      </header>

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="mx-auto max-w-screen-2xl px-6 pt-5">
          <WarningSection warnings={warnings} isLoading={isLoading} />
        </div>
      )}

      {/* Main Layout: Sidebar | Timeline | SmartMatch */}
      <main className="mx-auto flex max-w-screen-2xl gap-6 px-6 py-6 items-start">
        <TravelerProfileSidebar
          profile={profile}
          travelers={travelers}
          onSelectTraveler={handleSelectTraveler}
          isLoading={isLoading}
        />
        <TimelineView
          events={itineraryEvents}
          isLoading={isLoading || isLoadingItinerary}
          onRemoveEvent={handleRemoveEvent}
          onReorderEvents={handleReorderEvents}
          onUpdateEventTime={handleUpdateEventTime}
        />
        <SmartMatchPanel
          recommendations={recommendations}
          isLoading={isLoading}
          isMatching={isReMatching}
          onReMatch={handleReMatch}
          onAddEvent={handleAddEvent}
        />
      </main>
    </div>
  );
}
