import { NextRequest, NextResponse } from 'next/server';
import { generateTextEmbedding, generateProviderEmbedding } from '@/lib/ai/embeddings';
import { createServerSupabaseClient } from '@/lib/supabase/server';
import type { SmartMatchRecommendation, ExperienceProvider } from '@/types/itinerary';

export const dynamic = 'force-dynamic';

interface MatchRequestBody {
  interests?: string[];
  destinations?: string[];
  city?: string;
  tenant_id?: string;
  limit?: number;
}

interface DbMatchedProvider {
  id: string;
  tenant_id: string;
  name: string;
  city: string;
  experience_type: string;
  capacity: number | null;
  verification_status: 'pending' | 'verified' | 'rejected';
  phone_number?: string | null;
  similarity: number;
  match_score: number;
  reasons: string[];
}

export async function POST(request: NextRequest) {
  try {
    let body: MatchRequestBody = {};
    try {
      body = (await request.json()) as MatchRequestBody;
    } catch {}

    const interests = Array.isArray(body.interests) ? body.interests : ['تراث وثقافة', 'سفاري صحراوي'];
    const supabase = createServerSupabaseClient();
    let tenantId = body.tenant_id?.trim();
    if (!tenantId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('tenant_id')
        .limit(1)
        .maybeSingle();
      tenantId = org?.tenant_id;
    }
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: 'Tenant ID is required and could not be resolved.' },
        { status: 400 }
      );
    }
    const limit = typeof body.limit === 'number' ? body.limit : 5;

    const { data: unindexedProviders } = await supabase
      .from('experience_providers')
      .select('id, name, city, experience_type, capacity, verification_status')
      .is('embedding', null);

    if (unindexedProviders && unindexedProviders.length > 0) {
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
    }

    const queryText = `اهتمامات الزائر: ${interests.join('، ')} | الوجهات السياحية المطلوبة: ${destinations.join('، ')}`;

    const queryEmbedding = await generateTextEmbedding(queryText);

    const { data: matchedRows, error: rpcError } = await supabase.rpc('match_providers_hybrid', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: interests.join(' '),
      match_threshold: 0.0,
      match_count: limit,
      p_tenant_id: tenantId,
    });

    if (rpcError) {
      return NextResponse.json(
        { success: false, error: `RPC Error: ${rpcError.message}` },
        { status: 500 }
      );
    }

    const rows = (matchedRows as DbMatchedProvider[]) || [];

    const recommendations: SmartMatchRecommendation[] = rows
      .filter((row) => row.verification_status === 'verified')
      .map((row) => {
        const provider: ExperienceProvider = {
          id: row.id,
          tenantId: row.tenant_id,
          name: row.name,
          city: row.city,
          experienceType: row.experience_type,
          capacity: row.capacity ?? 10,
          verificationStatus: row.verification_status,
          phoneNumber: row.phone_number || undefined,
          rating: 4.8,
          priceRange: '$$$',
        };

        return {
          provider,
          matchScore: row.match_score,
          reasons: Array.isArray(row.reasons) ? row.reasons : ['تطابق مع تفضيلات الرحلة'],
        };
      });

    return NextResponse.json({
      success: true,
      count: recommendations.length,
      recommendations,
    });
  } catch (error) {
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error occurred.',
      },
      { status: 500 }
    );
  }
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const interestsParam = searchParams.get('interests');
    const interests = interestsParam ? interestsParam.split(',') : ['تراث وثقافة', 'سفاري صحراوي'];
    const supabase = createServerSupabaseClient();
    let tenantId = searchParams.get('tenant_id')?.trim();
    if (!tenantId) {
      const { data: org } = await supabase
        .from('organizations')
        .select('tenant_id')
        .limit(1)
        .maybeSingle();
      tenantId = org?.tenant_id;
    }
    if (!tenantId) {
      return NextResponse.json(
        { success: false, error: 'Tenant ID is required and could not be resolved.' },
        { status: 400 }
      );
    }

    const { data: unindexedProviders, error: selectErr } = await supabase
      .from('experience_providers')
      .select('id, name, city, experience_type, capacity, verification_status')
      .is('embedding', null);

    if (unindexedProviders && unindexedProviders.length > 0) {
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
    }

    const queryText = `اهتمامات الزائر: ${interests.join('، ')}`;
    const queryEmbedding = await generateTextEmbedding(queryText);

    const { data: matchedRows, error: rpcError } = await supabase.rpc('match_providers_hybrid', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: interests.join(' '),
      match_threshold: 0.0,
      match_count: 5,
      p_tenant_id: tenantId,
    });

    if (rpcError) {
      return NextResponse.json({ success: false, rpcError }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      debug_unindexed_count: unindexedProviders?.length ?? 0,
      debug_select_error: selectErr,
      embedding_dim: queryEmbedding.length,
      sample_embedding: queryEmbedding.slice(0, 3),
      count: matchedRows?.length ?? 0,
      results: matchedRows,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ success: false, error: message, stack }, { status: 500 });
  }
}
