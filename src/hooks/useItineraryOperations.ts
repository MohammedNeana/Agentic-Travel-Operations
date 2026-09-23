'use client';

import { useState, useEffect, useCallback } from 'react';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import { detectScheduleWarnings } from '@/lib/itinerary/warnings';
import { defaultArabicTravelerProfile } from '@/components/itinerary/TravelerProfileSidebar';
import type {
  TravelerProfile,
  Itinerary,
  ItineraryEvent,
  ExperienceProvider,
  SmartMatchRecommendation,
  ScheduleWarning,
} from '@/types/itinerary';

export interface UseItineraryOperationsOptions {
  initialItinerary?: Itinerary | null;
  initialRecommendations?: SmartMatchRecommendation[];
  initialWarnings?: ScheduleWarning[];
  initialProfile?: TravelerProfile | null;
  initialTravelers?: TravelerProfile[];
}

export function useItineraryOperations({
  initialItinerary,
  initialRecommendations = [],
  initialWarnings = [],
  initialProfile = defaultArabicTravelerProfile,
  initialTravelers = [],
}: UseItineraryOperationsOptions = {}) {
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

  useEffect(() => {
    const handleRejection = (event: PromiseRejectionEvent) => {
      const reasonStr = String(event.reason?.stack || event.reason || '');
      if (reasonStr.includes('chrome-extension:' + String.fromCharCode(47, 47))) {
        event.preventDefault();
      }
    };
    window.addEventListener('unhandledrejection', handleRejection);
    return () => window.removeEventListener('unhandledrejection', handleRejection);
  }, []);

  useEffect(() => {
    if (!profile?.id) return;

    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`realtime-itinerary-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_events' },
        async () => {
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
          } catch {}
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [profile?.id, hasUnsavedChanges]);

  const handleSelectTraveler = useCallback(async (newProfile: TravelerProfile) => {
    setProfile(newProfile);
    setIsReMatching(true);
    setIsLoadingItinerary(true);
    setHasUnsavedChanges(false);
    setSaveSuccess(false);

    try {
      const [matchRes, itinRes] = await Promise.all([
        fetch('/api/providers/match', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            interests: newProfile.interests,
            tenant_id: newProfile.tenantId || itinerary?.tenantId || undefined,
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
    } catch {
    } finally {
      setIsReMatching(false);
      setIsLoadingItinerary(false);
    }
  }, [itinerary?.tenantId]);

  const handleReMatch = useCallback(async () => {
    setIsReMatching(true);
    try {
      const res = await fetch('/api/providers/match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          interests: profile?.interests,
          tenant_id: profile?.tenantId || itinerary?.tenantId || undefined,
        }),
      });
      const data = await res.json();
      if (data.success && Array.isArray(data.recommendations)) {
        setRecommendations(data.recommendations);
      }
    } catch {
    } finally {
      setIsReMatching(false);
    }
  }, [profile?.interests, profile?.tenantId, itinerary?.tenantId]);

  const handleAddEvent = useCallback((provider: ExperienceProvider) => {
    const lastEvent = itineraryEvents[itineraryEvents.length - 1];
    const eventDate = lastEvent?.eventDate || itinerary?.startDate || profile?.arrivalDate || '2026-10-18';
    const dayEvents = itineraryEvents.filter((e) => e.eventDate === eventDate);
    const sortOrder = dayEvents.length + 1;

    let smartStart = '09:00';
    let smartEnd = '12:00';

    if (dayEvents.length > 0) {
      const sortedByEnd = [...dayEvents].sort((a, b) => b.endTime.localeCompare(a.endTime));
      const latestEnd = sortedByEnd[0].endTime;
      const [hStr, mStr] = latestEnd.split(':');
      const latestH = parseInt(hStr, 10) || 12;
      const latestM = mStr || '00';

      const nextStartH = latestH + 1;
      const nextEndH = nextStartH + 3;

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
      tenantId: itinerary?.tenantId || profile?.tenantId || '',
      itineraryId: itinerary?.id || '',
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
  }, [itineraryEvents, itinerary?.startDate, itinerary?.tenantId, itinerary?.id, profile]);

  const handleReorderEvents = useCallback((sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;

    const sourceIdx = itineraryEvents.findIndex((e) => e.id === sourceId);
    const targetIdx = itineraryEvents.findIndex((e) => e.id === targetId);
    if (sourceIdx === -1 || targetIdx === -1) return;

    const sourceEvent = itineraryEvents[sourceIdx];
    const targetEvent = itineraryEvents[targetIdx];

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

    newEvents.sort((a, b) => {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });

    setItineraryEvents(newEvents);
    setWarnings(detectScheduleWarnings(newEvents, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  }, [itineraryEvents, profile]);

  const handleUpdateEventTime = useCallback((
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

    newEvents.sort((a, b) => {
      const dateCmp = a.eventDate.localeCompare(b.eventDate);
      if (dateCmp !== 0) return dateCmp;
      return a.startTime.localeCompare(b.startTime);
    });

    setItineraryEvents(newEvents);
    setWarnings(detectScheduleWarnings(newEvents, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  }, [itineraryEvents, profile]);

  const handleRemoveEvent = useCallback((eventId: string) => {
    const updated = itineraryEvents.filter((e) => e.id !== eventId);
    setItineraryEvents(updated);
    setWarnings(detectScheduleWarnings(updated, profile));
    setHasUnsavedChanges(true);
    setSaveSuccess(false);
  }, [itineraryEvents, profile]);

  const handleSaveItinerary = useCallback(async () => {
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
          setSaveFeedbackText('تم الحفظ وإرسال إشعار واتساب للمزود');
        } else {
          setSaveFeedbackText('تم الحفظ بنجاح');
        }
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 4500);
      } else {
        alert(`فشل الحفظ: ${data.error || 'حدث خطأ غير متوقع'}`);
      }
    } catch {
      alert('تعذر الاتصال بالخادم لحفظ التغييرات.');
    } finally {
      setIsSaving(false);
    }
  }, [itinerary?.id, itinerary?.tenantId, itineraryEvents, profile]);

  return {
    isMounted,
    profile,
    travelers,
    itinerary,
    itineraryEvents,
    recommendations,
    warnings,
    isReMatching,
    isLoadingItinerary,
    isSaving,
    saveSuccess,
    saveFeedbackText,
    hasUnsavedChanges,
    handleSelectTraveler,
    handleReMatch,
    handleAddEvent,
    handleReorderEvents,
    handleUpdateEventTime,
    handleRemoveEvent,
    handleSaveItinerary,
  };
}
