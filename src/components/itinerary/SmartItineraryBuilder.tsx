'use client';

import { useState, useEffect } from 'react';
import { TravelerProfileSidebar, defaultArabicTravelerProfile } from '@/components/itinerary/TravelerProfileSidebar';
import { TimelineView } from '@/components/itinerary/TimelineView';
import { SmartMatchPanel } from '@/components/itinerary/SmartMatchPanel';
import { WarningSection } from '@/components/itinerary/WarningSection';
import ar from '@/lib/i18n/ar';
import { formatArabicDateRange } from '@/lib/i18n/date';
import { createBrowserSupabaseClient } from '@/lib/supabase/client';
import type {
  TravelerProfile,
  Itinerary,
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
  const [recommendations, setRecommendations] = useState<SmartMatchRecommendation[]>(initialRecommendations);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>(initialWarnings);
  const [isReMatching, setIsReMatching] = useState(false);
  const [isLoadingItinerary, setIsLoadingItinerary] = useState(false);

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

  // Real-time WebSocket subscription via Supabase Realtime for instant event updates (zero polling spam)
  useEffect(() => {
    if (!profile?.id) return;

    const supabase = createBrowserSupabaseClient();
    const channel = supabase
      .channel(`realtime-itinerary-${profile.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'itinerary_events' },
        async () => {
          try {
            const res = await fetch(`/api/itineraries?traveler_id=${profile.id}`);
            const data = await res.json();
            if (data.success && data.itinerary) {
              setItinerary(data.itinerary);
              setWarnings(data.warnings || []);
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
  }, [profile?.id]);

  const handleSelectTraveler = async (newProfile: TravelerProfile) => {
    setProfile(newProfile);
    setIsReMatching(true);
    setIsLoadingItinerary(true);
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
        setWarnings(itinData.warnings || []);
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
  const events = activeItinerary?.events ?? [];

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
            <button
              type="button"
              className="rounded-xl bg-gray-900 px-4.5 py-2.5 text-xs font-bold text-white shadow-xs transition-all hover:bg-gray-800 hover:shadow-md cursor-pointer"
            >
              {ar.header.saveItinerary}
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
        <TimelineView events={events} isLoading={isLoading || isLoadingItinerary} />
        <SmartMatchPanel
          recommendations={recommendations}
          isLoading={isLoading}
          isMatching={isReMatching}
          onReMatch={handleReMatch}
        />
      </main>
    </div>
  );
}
