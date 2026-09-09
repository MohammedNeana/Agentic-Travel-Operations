'use client';

import { useState, useEffect } from 'react';
import { TravelerProfileSidebar, defaultArabicTravelerProfile } from '@/components/itinerary/TravelerProfileSidebar';
import { TimelineView } from '@/components/itinerary/TimelineView';
import { SmartMatchPanel } from '@/components/itinerary/SmartMatchPanel';
import { WarningSection } from '@/components/itinerary/WarningSection';
import ar from '@/lib/i18n/ar';
import { formatArabicDateRange } from '@/lib/i18n/date';
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
  isLoading?: boolean;
}

export function SmartItineraryBuilder({
  initialItinerary,
  initialRecommendations = [],
  initialWarnings = [],
  initialProfile = defaultArabicTravelerProfile,
  isLoading = false,
}: SmartItineraryBuilderProps) {
  const [isMounted, setIsMounted] = useState(false);
  const [profile] = useState<TravelerProfile | null>(initialProfile);
  const [itinerary] = useState<Itinerary | null>(initialItinerary ?? null);
  const [recommendations] = useState<SmartMatchRecommendation[]>(initialRecommendations);
  const [warnings] = useState<ScheduleWarning[]>(initialWarnings);

  useEffect(() => {
    setIsMounted(true);
  }, []);

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
      <header className="sticky top-0 z-20 border-b border-gray-100 bg-white/90 backdrop-blur-md">
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
        <TravelerProfileSidebar profile={profile} isLoading={isLoading} />
        <TimelineView events={events} isLoading={isLoading} />
        <SmartMatchPanel recommendations={recommendations} isLoading={isLoading} />
      </main>
    </div>
  );
}
