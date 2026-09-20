import { createServerSupabaseClient } from '@/lib/supabase/server';
import { generateTextEmbedding, generateProviderEmbedding } from '@/lib/ai/embeddings';
import type {
  Itinerary,
  ItineraryEvent,
  ExperienceProvider,
  SmartMatchRecommendation,
  ScheduleWarning,
  TravelerProfile,
} from '@/types/itinerary';

interface DbExperienceProvider {
  id: string;
  tenant_id: string;
  name: string;
  city: string;
  experience_type: string;
  capacity: number;
  verification_status: 'pending' | 'verified' | 'rejected';
  phone_number?: string | null;
}

interface DbItineraryEvent {
  id: string;
  tenant_id: string;
  itinerary_id: string;
  experience_provider_id?: string | null;
  title: string;
  description?: string | null;
  event_date: string;
  start_time: string;
  end_time: string;
  sort_order: number;
  status: 'planned' | 'confirmed' | 'cancelled' | 'escalated';
  escalation_reason?: string | null;
  experience_providers?: DbExperienceProvider | null;
}

interface DbItinerary {
  id: string;
  tenant_id: string;
  organization_id: string;
  title: string;
  description?: string | null;
  start_date: string;
  end_date: string;
  status: 'draft' | 'confirmed' | 'in_progress' | 'completed' | 'cancelled';
  guest_count: number;
}

function mapProvider(db: DbExperienceProvider): ExperienceProvider {
  const ratings: Record<string, number> = {
    'جولات تراث العُلا': 4.9,
    'رحلات الربع الخالي': 4.8,
    'مجموعة جدة للطهي': 4.7,
    'شركة الغوص في البحر الأحمر': 4.5,
    'جولات تصوير بوابة الدرعية': 4.6,
  };

  const prices: Record<string, string> = {
    'جولات تراث العُلا': '$$$',
    'رحلات الربع الخالي': '$$$$',
    'مجموعة جدة للطهي': '$$',
    'شركة الغوص في البحر الأحمر': '$$$',
    'جولات تصوير بوابة الدرعية': '$$',
  };

  return {
    id: db.id,
    tenantId: db.tenant_id,
    name: db.name,
    city: db.city,
    experienceType: db.experience_type,
    capacity: db.capacity,
    verificationStatus: db.verification_status,
    phoneNumber: db.phone_number || undefined,
    rating: ratings[db.name] ?? 4.8,
    priceRange: prices[db.name] ?? '$$$',
  };
}

export async function getExperienceProviders(): Promise<ExperienceProvider[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('experience_providers')
    .select('id, tenant_id, name, city, experience_type, capacity, verification_status, phone_number')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching experience providers:', error);
    return [];
  }

  return (data as DbExperienceProvider[]).map(mapProvider);
}

export async function getActiveItinerary(travelerId?: string): Promise<Itinerary | null> {
  const supabase = createServerSupabaseClient();

  let query = supabase.from('itineraries').select('*');
  if (travelerId) {
    query = query.eq('traveler_profile_id', travelerId);
  }

  let { data: itineraryData, error: itError } = await query
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

  if ((itError || !itineraryData) && travelerId) {
    // If not found by traveler_profile_id, fall back to first itinerary
    const fallback = await supabase
      .from('itineraries')
      .select('*')
      .order('created_at', { ascending: true })
      .limit(1)
      .single();
    itineraryData = fallback.data;
    itError = fallback.error;
  }

  if (itError || !itineraryData) {
    console.error('Error fetching itinerary:', itError);
    return null;
  }

  const { data: eventsData, error: evError } = await supabase
    .from('itinerary_events')
    .select('*, experience_providers(*)')
    .eq('itinerary_id', itineraryData.id)
    .order('event_date', { ascending: true })
    .order('sort_order', { ascending: true });

  if (evError) {
    console.error('Error fetching events:', evError);
  }

  const events: ItineraryEvent[] = ((eventsData as DbItineraryEvent[]) || []).map((ev) => ({
    id: ev.id,
    tenantId: ev.tenant_id,
    itineraryId: ev.itinerary_id,
    experienceProviderId: ev.experience_provider_id ?? undefined,
    title: ev.title,
    description: ev.description ?? undefined,
    eventDate: ev.event_date,
    startTime: ev.start_time ? ev.start_time.substring(0, 5) : '',
    endTime: ev.end_time ? ev.end_time.substring(0, 5) : '',
    sortOrder: ev.sort_order,
    status: ev.status,
    escalationReason: ev.escalation_reason ?? undefined,
    provider: ev.experience_providers ? mapProvider(ev.experience_providers) : undefined,
  }));

  const it = itineraryData as DbItinerary;
  return {
    id: it.id,
    tenantId: it.tenant_id,
    organizationId: it.organization_id,
    title: it.title,
    description: it.description ?? undefined,
    startDate: it.start_date,
    endDate: it.end_date,
    status: it.status,
    guestCount: it.guest_count,
    events,
  };
}

interface DbTravelerProfile {
  id: string;
  tenant_id: string;
  name: string;
  nationality: string;
  group_size: number;
  budget_tier: string;
  interests: string[];
  dietary_restrictions: string[];
  mobility_notes: string | null;
  arrival_date: string | null;
  departure_date: string | null;
}

export async function getTravelerProfiles(
  tenantId = 'a1b2c3d4-0001-4000-8000-000000000001'
): Promise<TravelerProfile[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('traveler_profiles')
    .select('*')
    .eq('tenant_id', tenantId)
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching traveler profiles:', error);
    return [];
  }

  return ((data as DbTravelerProfile[]) || []).map((row) => ({
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    nationality: row.nationality,
    groupSize: row.group_size,
    budgetTier: row.budget_tier,
    interests: Array.isArray(row.interests) ? row.interests : [],
    dietaryRestrictions: Array.isArray(row.dietary_restrictions) ? row.dietary_restrictions : [],
    mobilityNotes: row.mobility_notes || '',
    arrivalDate: row.arrival_date || '2026-10-15',
    departureDate: row.departure_date || '2026-10-22',
  }));
}

export async function getSmartMatchRecommendations(
  profile?: TravelerProfile | null,
  tenantId = 'a1b2c3d4-0001-4000-8000-000000000001'
): Promise<SmartMatchRecommendation[]> {
  try {
    const interests = profile?.interests && profile.interests.length > 0
      ? profile.interests
      : ['تراث وثقافة', 'سفاري صحراوي', 'تجارب طهي', 'تصوير'];

    const budgetInfo = profile?.budgetTier ? `الميزانية: ${profile.budgetTier}` : '';
    const queryText = `اهتمامات الزائر: ${interests.join('، ')} ${budgetInfo ? '| ' + budgetInfo : ''}`;
    console.log(`\x1b[34m[Itinerary Queries]\x1b[0m 🔍 Querying recommendations for traveler: "${profile?.name ?? 'Default'}"`);

    const supabase = createServerSupabaseClient();

    // Check if any providers have NULL embeddings and backfill them
    const { data: unindexedProviders } = await supabase
      .from('experience_providers')
      .select('id, name, city, experience_type, capacity, verification_status')
      .is('embedding', null);

    if (unindexedProviders && unindexedProviders.length > 0) {
      console.log(`\x1b[33m[Itinerary Queries]\x1b[0m ⚙️ Auto-backfilling 384-d embeddings for ${unindexedProviders.length} providers...`);
      for (const p of unindexedProviders) {
        const emb = await generateProviderEmbedding({
          name: p.name,
          city: p.city,
          experience_type: p.experience_type,
          capacity: p.capacity ?? 10,
          verification_status: p.verification_status,
        });
        await supabase
          .from('experience_providers')
          .update({ embedding: JSON.stringify(emb) })
          .eq('id', p.id);
      }
      console.log(`\x1b[32m[Itinerary Queries]\x1b[0m ✅ Backfilled embeddings for all providers.`);
    }

    // Generate real 384-dimensional vector embedding for traveler preferences
    const queryEmbedding = await generateTextEmbedding(queryText);

    const { data: rows, error } = await supabase.rpc('match_providers_hybrid', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: interests.join(' '),
      match_threshold: 0.0,
      match_count: 5,
      p_tenant_id: tenantId,
    });

    if (error) {
      console.error('Error in match_providers_hybrid RPC:', error);
      // Fall back to direct providers query if RPC encounters an issue
      const providers = await getExperienceProviders();
      return providers
        .filter((p) => p.verificationStatus === 'verified')
        .slice(0, 5)
        .map((p, idx) => ({
          provider: p,
          matchScore: 85 - idx * 5,
          reasons: ['مزود تجارب محلي معتمد', `مناسب لرحلات ${p.city}`],
        }));
    }

    console.log(`\x1b[34m[Itinerary Queries]\x1b[0m 📊 Received ${rows?.length ?? 0} hybrid matched providers from Supabase pgvector.`);

    interface DbMatchedRow {
      id: string;
      tenant_id: string;
      name: string;
      city: string;
      experience_type: string;
      capacity: number | null;
      verification_status: 'pending' | 'verified' | 'rejected';
      similarity: number;
      match_score: number;
      reasons: string[];
    }

    const matched = (rows as DbMatchedRow[]) || [];

    return matched
      .filter((m) => m.verification_status === 'verified')
      .map((m) => {
        const provider: ExperienceProvider = {
          id: m.id,
          tenantId: m.tenant_id,
          name: m.name,
          city: m.city,
          experienceType: m.experience_type,
          capacity: m.capacity ?? 10,
          verificationStatus: m.verification_status,
          rating: 4.8,
          priceRange: '$$$',
        };

        return {
          provider,
          matchScore: m.match_score,
          reasons: Array.isArray(m.reasons) ? m.reasons : ['تطابق مع تفضيلات الرحلة'],
        };
      });
  } catch (err) {
    console.error('Failed to get smart match recommendations:', err);
    return [];
  }
}

export { detectScheduleWarnings } from '@/lib/itinerary/warnings';
