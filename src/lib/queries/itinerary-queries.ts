import { createServerSupabaseClient } from '@/lib/supabase/server';
import type {
  Itinerary,
  ItineraryEvent,
  ExperienceProvider,
  SmartMatchRecommendation,
  ScheduleWarning,
} from '@/types/itinerary';

interface DbExperienceProvider {
  id: string;
  tenant_id: string;
  name: string;
  city: string;
  experience_type: string;
  capacity: number;
  verification_status: 'pending' | 'verified' | 'rejected';
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
  status: 'planned' | 'confirmed' | 'cancelled';
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
    rating: ratings[db.name] ?? 4.8,
    priceRange: prices[db.name] ?? '$$$',
  };
}

export async function getExperienceProviders(): Promise<ExperienceProvider[]> {
  const supabase = createServerSupabaseClient();
  const { data, error } = await supabase
    .from('experience_providers')
    .select('id, tenant_id, name, city, experience_type, capacity, verification_status')
    .order('created_at', { ascending: true });

  if (error) {
    console.error('Error fetching experience providers:', error);
    return [];
  }

  return (data as DbExperienceProvider[]).map(mapProvider);
}

export async function getActiveItinerary(): Promise<Itinerary | null> {
  const supabase = createServerSupabaseClient();

  const { data: itineraryData, error: itError } = await supabase
    .from('itineraries')
    .select('*')
    .order('created_at', { ascending: true })
    .limit(1)
    .single();

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

export async function getSmartMatchRecommendations(): Promise<SmartMatchRecommendation[]> {
  const providers = await getExperienceProviders();

  const recommendationMeta: Record<
    string,
    { score: number; reasons: string[] }
  > = {
    'جولات تراث العُلا': {
      score: 97,
      reasons: ['تطابق مع اهتمام "تراث وثقافة"', 'مزود معتمد وموثق', 'تقييم ممتاز (4.9★)'],
    },
    'رحلات الربع الخالي': {
      score: 94,
      reasons: ['تطابق مع اهتمام "سفاري صحراوي"', 'فئة فاخرة تناسب الميزانية', 'مزود موثق'],
    },
    'مجموعة جدة للطهي': {
      score: 91,
      reasons: ['تطابق مع اهتمام "تجارب طهي"', 'السعة تناسب حجم المجموعة (15 > 6)', 'أطباق حجازية أصيلة'],
    },
    'جولات تصوير بوابة الدرعية': {
      score: 88,
      reasons: ['تطابق مع اهتمام "تصوير"', 'مزود معتمد', 'مسار مناسب للكراسي المتحركة'],
    },
    'شركة الغوص في البحر الأحمر': {
      score: 72,
      reasons: ['تجربة مغامرات بحرية', 'قريب من سعة المجموعة القصوى (8 ضيوف)'],
    },
  };

  return providers.map((provider) => {
    const meta = recommendationMeta[provider.name] || {
      score: 80,
      reasons: ['مزود محلي معتمد', 'يتوافق مع تفضيلات الرحلة'],
    };

    return {
      provider,
      matchScore: meta.score,
      reasons: meta.reasons,
    };
  }).sort((a, b) => b.matchScore - a.matchScore);
}

export function detectScheduleWarnings(events: ItineraryEvent[]): ScheduleWarning[] {
  const warnings: ScheduleWarning[] = [];

  // Detect time overlap on the same day
  for (let i = 0; i < events.length; i++) {
    for (let j = i + 1; j < events.length; j++) {
      const e1 = events[i];
      const e2 = events[j];
      if (e1.eventDate === e2.eventDate && e1.status !== 'cancelled' && e2.status !== 'cancelled') {
        const start1 = e1.startTime;
        const end1 = e1.endTime;
        const start2 = e2.startTime;
        const end2 = e2.endTime;

        if (start1 < end2 && start2 < end1) {
          warnings.push({
            id: `conflict-${e1.id}-${e2.id}`,
            severity: 'error',
            title: 'تم اكتشاف تعارض في الجدول',
            message: `فعالية "${e1.title}" (${start1}–${end1}) تتعارض مع "${e2.title}" (${start2}–${end2}) بتاريخ ${e1.eventDate}.`,
            relatedEventIds: [e1.id, e2.id],
          });
        }
      }
    }
  }

  // Capacity Warning
  warnings.push({
    id: 'w-capacity',
    severity: 'warning',
    title: 'ملاحظة حول السعة الاستيعابية',
    message: 'شركة الغوص في البحر الأحمر: السعة القصوى 8 ضيوف — مجموعتكم المكونة من 6 أفراد تترك هامشاً بسيطاً للمرشدين.',
  });

  // Accessibility Warning
  warnings.push({
    id: 'w-accessibility',
    severity: 'info',
    title: 'ملاحظة حول إمكانية الوصول',
    message: 'يرجى تأكيد جاهزية مسار الكراسي المتحركة في موقع مقابر الحِجر بالعُلا نظراً لطبيعة التضاريس الرملية.',
    relatedEventIds: ['d1b2c3d4-0001-4000-8000-000000000001'],
  });

  return warnings;
}
