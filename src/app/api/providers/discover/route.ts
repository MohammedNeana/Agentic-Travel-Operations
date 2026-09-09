import { NextRequest, NextResponse } from 'next/server';
import { extractExperienceProvider } from '@/lib/ai/extraction';
import { generateProviderEmbedding } from '@/lib/ai/embeddings';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface DiscoverRequestBody {
  text_content?: string;
  tenant_id?: string;
}

/**
 * Resolves the active tenant ID for insertion, defaulting to the primary DMC organization.
 */
async function resolveTenantId(providedTenantId?: string): Promise<string> {
  if (providedTenantId && providedTenantId.trim().length > 0) {
    return providedTenantId.trim();
  }

  const supabase = createServerSupabaseClient();
  const { data: org } = await supabase
    .from('organizations')
    .select('tenant_id')
    .limit(1)
    .maybeSingle();

  if (org?.tenant_id) {
    return org.tenant_id;
  }

  // Fallback to default seeded tenant UUID
  return 'a1b2c3d4-0001-4000-8000-000000000001';
}

/**
 * POST /api/providers/discover
 *
 * Ingests scraped text content of a Saudi experience provider, performs structured AI
 * extraction using Zod, generates a 1536-dimensional embedding using text-embedding-3-small,
 * and securely saves the provider to the Supabase experience_providers table.
 */
export async function POST(request: NextRequest) {
  try {
    let body: DiscoverRequestBody;
    try {
      body = (await request.json()) as DiscoverRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request payload.' },
        { status: 400 }
      );
    }

    const textContent = body.text_content;
    if (!textContent || typeof textContent !== 'string' || textContent.trim().length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field "text_content". Provide description or scraped text.',
        },
        { status: 400 }
      );
    }

    // 1. Structured AI Extraction (Zod verified)
    const extracted = await extractExperienceProvider(textContent);

    // 2. Vector Embedding Generation (1536-dim text-embedding-3-small)
    const embedding = await generateProviderEmbedding(extracted);

    // 3. Resolve Tenant ID
    const tenantId = await resolveTenantId(body.tenant_id);

    // 4. Secure Database Insertion via Supabase Server Client
    const supabase = createServerSupabaseClient();
    const { data: insertedProvider, error: insertError } = await supabase
      .from('experience_providers')
      .insert({
        tenant_id: tenantId,
        name: extracted.name,
        city: extracted.city,
        experience_type: extracted.experience_type,
        capacity: extracted.capacity,
        verification_status: extracted.verification_status,
        embedding: JSON.stringify(embedding), // Format for pgvector column
      })
      .select('id, tenant_id, name, city, experience_type, capacity, verification_status, created_at')
      .single();

    if (insertError || !insertedProvider) {
      console.error('Failed to insert experience provider into Supabase:', insertError);
      return NextResponse.json(
        {
          success: false,
          error: `Database insertion error: ${insertError?.message || 'Unknown error'}`,
          extracted,
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        message: 'Experience provider successfully extracted and saved.',
        provider: insertedProvider,
        embedding_dimensions: embedding.length,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('Unexpected error in /api/providers/discover:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error occurred.',
      },
      { status: 500 }
    );
  }
}
