import { SmartItineraryBuilder } from '@/components/itinerary/SmartItineraryBuilder';
import {
  getActiveItinerary,
  getSmartMatchRecommendations,
  detectScheduleWarnings,
} from '@/lib/queries/itinerary-queries';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const [itinerary, recommendations] = await Promise.all([
    getActiveItinerary(),
    getSmartMatchRecommendations(),
  ]);

  const warnings = itinerary ? detectScheduleWarnings(itinerary.events) : [];

  return (
    <SmartItineraryBuilder
      initialItinerary={itinerary}
      initialRecommendations={recommendations}
      initialWarnings={warnings}
    />
  );
}
