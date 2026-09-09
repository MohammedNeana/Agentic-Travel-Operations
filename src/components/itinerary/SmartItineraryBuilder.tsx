'use client';

import { useEffect, useState } from 'react';
import { TravelerProfileSidebar } from '@/components/itinerary/TravelerProfileSidebar';
import { TimelineView } from '@/components/itinerary/TimelineView';
import { SmartMatchPanel } from '@/components/itinerary/SmartMatchPanel';
import { WarningSection } from '@/components/itinerary/WarningSection';
import {
  mockTravelerProfile,
  mockEvents,
  mockRecommendations,
  mockWarnings,
} from '@/lib/mock-data';
import type {
  TravelerProfile,
  ItineraryEvent,
  SmartMatchRecommendation,
  ScheduleWarning,
} from '@/types/itinerary';

export function SmartItineraryBuilder() {
  const [isLoading, setIsLoading] = useState(true);
  const [profile, setProfile] = useState<TravelerProfile | null>(null);
  const [events, setEvents] = useState<ItineraryEvent[]>([]);
  const [recommendations, setRecommendations] = useState<SmartMatchRecommendation[]>([]);
  const [warnings, setWarnings] = useState<ScheduleWarning[]>([]);

  // Simulate async data fetch with staggered loading
  useEffect(() => {
    const timer = setTimeout(() => {
      setProfile(mockTravelerProfile);
      setEvents(mockEvents);
      setRecommendations(mockRecommendations);
      setWarnings(mockWarnings);
      setIsLoading(false);
    }, 1500);

    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-h-screen bg-gray-50/50">
      {/* Top Bar */}
      <header className="border-b border-gray-100 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-screen-2xl items-center justify-between px-6 py-4">
          <div>
            <h1 className="text-lg font-semibold tracking-tight text-gray-900">
              Itinerary Builder
            </h1>
            <p className="text-xs text-gray-400">
              {profile
                ? `${profile.name} · ${formatDateRange(profile.arrivalDate, profile.departureDate)}`
                : 'Loading traveler...'}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center rounded-full bg-gray-100 px-3 py-1 text-[11px] font-medium text-gray-500">
              Draft
            </span>
            <button
              type="button"
              className="rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-gray-800"
            >
              Save Itinerary
            </button>
          </div>
        </div>
      </header>

      {/* Warnings */}
      <div className="mx-auto max-w-screen-2xl px-6 pt-5">
        <WarningSection warnings={warnings} isLoading={isLoading} />
      </div>

      {/* Main Layout: Sidebar | Timeline | SmartMatch */}
      <main className="mx-auto flex max-w-screen-2xl gap-6 px-6 py-6">
        <TravelerProfileSidebar profile={profile} isLoading={isLoading} />
        <TimelineView events={events} isLoading={isLoading} />
        <SmartMatchPanel recommendations={recommendations} isLoading={isLoading} />
      </main>
    </div>
  );
}

// ─── Helpers ─────────────────────────────────────────────────

function formatDateRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}
