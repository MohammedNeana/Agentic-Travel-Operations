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
    } catch {
      // Empty body is acceptable, fallback to defaults
    }

    const interests = Array.isArray(body.interests) ? body.interests : ['تراث وثقافة', 'سفاري صحراوي'];
    const destinations = Array.isArray(body.destinations) ? body.destinations : ['العُلا', 'الرياض'];
    const tenantId = body.tenant_id?.trim() || 'a1b2c3d4-0001-4000-8000-000000000001';
    const limit = typeof body.limit === 'number' ? body.limit : 5;

    const supabase = createServerSupabaseClient();

    // Automatically backfill embeddings for any providers that have NULL embeddings
    const { data: unindexedProviders } = await supabase
      .from('experience_providers')
      .select('id, name, city, experience_type, capacity, verification_status')
      .is('embedding', null);

    if (unindexedProviders && unindexedProviders.length > 0) {
      console.log(`\x1b[33m[Smart Match API]\x1b[0m ⚙️ Backfilling 384-d embeddings for ${unindexedProviders.length} unindexed providers...`);
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
      console.log(`\x1b[32m[Smart Match API]\x1b[0m ✅ Backfill complete for all providers.`);
    }

    // Compose semantic query text representing traveler's requirements
    const queryText = `اهتمامات الزائر: ${interests.join('، ')} | الوجهات السياحية المطلوبة: ${destinations.join('، ')}`;
    console.log(`\x1b[35m[Smart Match API]\x1b[0m 🎯 Matching for: [${interests.join(', ')}] | tenant: ${tenantId}`);

    // 1. Generate 384-dimensional vector embedding for traveler preferences
    const queryEmbedding = await generateTextEmbedding(queryText);

    // 2. Call Supabase pgvector hybrid search function
    const { data: matchedRows, error: rpcError } = await supabase.rpc('match_providers_hybrid', {
      query_embedding: JSON.stringify(queryEmbedding),
      query_text: interests.join(' '),
      match_threshold: 0.0,
      match_count: limit,
      p_tenant_id: tenantId,
    });

    if (rpcError) {
      console.error('Error invoking match_providers_hybrid RPC:', rpcError);
      return NextResponse.json(
        { success: false, error: `RPC Error: ${rpcError.message}` },
        { status: 500 }
      );
    }

    const rows = (matchedRows as DbMatchedProvider[]) || [];

    // 3. Map to strictly typed SmartMatchRecommendation
    const recommendations: SmartMatchRecommendation[] = rows.map((row) => {
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

    console.log(
      `\x1b[35m[Smart Match API]\x1b[0m ✨ pgvector returned ${recommendations.length} providers (top score: ${recommendations[0]?.matchScore ?? 0}%)`
    );

    return NextResponse.json({
      success: true,
      count: recommendations.length,
      recommendations,
    });
  } catch (error) {
    console.error('Unexpected error in /api/providers/match:', error);
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
    const tenantId = searchParams.get('tenant_id') || 'a1b2c3d4-0001-4000-8000-000000000001';

    const supabase = createServerSupabaseClient();

    // Automatically backfill embeddings for any providers that have NULL embeddings
    const { data: unindexedProviders, error: selectErr } = await supabase
      .from('experience_providers')
      .select('id, name, city, experience_type, capacity, verification_status')
      .is('embedding', null);

    console.log(`[Backfill Debug] Found ${unindexedProviders?.length ?? 0} unindexed providers. Select error:`, selectErr);

    if (unindexedProviders && unindexedProviders.length > 0) {
      console.log(`\x1b[33m[Smart Match API]\x1b[0m ⚙️ Backfilling 384-d embeddings for ${unindexedProviders.length} unindexed providers...`);
      for (const p of unindexedProviders) {
        const emb = await generateProviderEmbedding({
          name: p.name,
          city: p.city,
          experience_type: p.experience_type,
          capacity: p.capacity ?? 10,
          verification_status: p.verification_status,
        });
        const { error: updateErr } = await supabase
          .from('experience_providers')
          .update({ embedding: JSON.stringify(emb) })
          .eq('id', p.id);

        if (updateErr) {
          console.error(`[Backfill Error] Failed to update provider ${p.id}:`, updateErr);
        } else {
          console.log(`[Backfill Success] Updated provider ${p.name}`);
        }
      }
      console.log(`\x1b[32m[Smart Match API]\x1b[0m ✅ Backfill complete for all providers.`);
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


