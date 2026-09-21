import { NextRequest, NextResponse } from 'next/server';
import {
  getActiveItinerary,
  getTravelerProfiles,
  detectScheduleWarnings,
} from '@/lib/queries/itinerary-queries';
import { resolveAuthorizedTenantId } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const travelerId = searchParams.get('traveler_id') || undefined;
    const requestedTenant = searchParams.get('tenant_id') || undefined;

    let tenantId: string;
    try {
      tenantId = await resolveAuthorizedTenantId(req, requestedTenant);
    } catch (authError) {
      return NextResponse.json(
        {
          success: false,
          error: authError instanceof Error ? authError.message : 'Unauthorized: Valid tenant session required.',
        },
        { status: 401 }
      );
    }

    const [itinerary, travelers] = await Promise.all([
      getActiveItinerary({ tenantId, travelerId }),
      getTravelerProfiles(tenantId),
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
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to fetch itinerary',
      },
      { status: 500 }
    );
  }
}
