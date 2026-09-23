'use client';

import { Check, Loader2 } from 'lucide-react';
import { TravelerProfileSidebar, defaultArabicTravelerProfile } from '@/components/itinerary/TravelerProfileSidebar';
import { TimelineView } from '@/components/itinerary/TimelineView';
import { SmartMatchPanel } from '@/components/itinerary/SmartMatchPanel';
import { WarningSection } from '@/components/itinerary/WarningSection';
import ar from '@/lib/i18n/ar';
import { formatArabicDateRange } from '@/lib/i18n/date';
import { useItineraryOperations } from '@/hooks/useItineraryOperations';
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
  const {
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
  } = useItineraryOperations({
    initialItinerary,
    initialRecommendations,
    initialWarnings,
    initialProfile,
    initialTravelers,
  });

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

      {warnings.length > 0 && (
        <div className="mx-auto max-w-screen-2xl px-6 pt-5">
          <WarningSection warnings={warnings} isLoading={isLoading} />
        </div>
      )}

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
