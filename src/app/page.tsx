import { SmartItineraryBuilder } from '@/components/itinerary/SmartItineraryBuilder';
import { defaultArabicTravelerProfile } from '@/components/itinerary/TravelerProfileSidebar';
import {
  getActiveItinerary,
  getTravelerProfiles,
  getSmartMatchRecommendations,
  detectScheduleWarnings,
} from '@/lib/queries/itinerary-queries';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const travelers = await getTravelerProfiles();
  const activeProfile = travelers[0] ?? defaultArabicTravelerProfile;

  const [itinerary, recommendations] = await Promise.all([
    getActiveItinerary(activeProfile.id),
    getSmartMatchRecommendations(activeProfile),
  ]);

  const warnings = itinerary ? detectScheduleWarnings(itinerary.events, activeProfile) : [];

  return (
    <SmartItineraryBuilder
      initialItinerary={itinerary}
      initialRecommendations={recommendations}
      initialWarnings={warnings}
      initialProfile={activeProfile}
      initialTravelers={travelers}
    />
  );
}

