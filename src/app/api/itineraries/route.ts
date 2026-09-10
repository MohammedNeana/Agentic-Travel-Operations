import { NextRequest, NextResponse } from 'next/server';
import { getActiveItinerary, getTravelerProfiles, detectScheduleWarnings } from '@/lib/queries/itinerary-queries';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const travelerId = searchParams.get('traveler_id') || undefined;

    const [itinerary, travelers] = await Promise.all([
      getActiveItinerary(travelerId),
      getTravelerProfiles(),
    ]);

    const activeProfile = travelers.find((t) => t.id === travelerId) || travelers[0] || null;
    const warnings = itinerary ? detectScheduleWarnings(itinerary.events, activeProfile) : [];

    return NextResponse.json(
      {
        success: true,
        itinerary,
        warnings,
        traveler: activeProfile,
      },
      {
        headers: {
          'Cache-Control': 'no-store, no-cache, must-revalidate, proxy-revalidate',
        },
      }
    );
  } catch (error) {
    console.error('Error in GET /api/itineraries:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch itinerary',
      },
      { status: 500 }
    );
  }
}
