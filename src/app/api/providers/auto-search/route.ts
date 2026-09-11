import { NextRequest, NextResponse } from 'next/server';
import { extractExperienceProvider } from '@/lib/ai/extraction';
import { generateProviderEmbedding } from '@/lib/ai/embeddings';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface AutoSearchRequestBody {
  query?: string;
  tenant_id?: string;
  max_results?: number;
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

  return 'a1b2c3d4-0001-4000-8000-000000000001';
}

/**
 * Executes a broad web search using DuckDuckGo HTML parsing via cheerio
 * to retrieve top external candidate URLs without requiring paid API keys.
 */
async function searchWeb(query: string, maxResults = 3): Promise<string[]> {
  const urls: string[] = [];

  try {
    const cheerio = await import('cheerio');
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    console.log(`[Auto-Search Agent] 🌐 Autonomous web search query: "${query}"`);

    const response = await fetch(searchUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.9',
      },
      signal: AbortSignal.timeout(10000),
    });

    if (response.ok) {
      const html = await response.text();
      const $ = cheerio.load(html);

      // Extract result links from DDG HTML
      $('a.result__url, a.result__snippet, .web-result a').each((_, el) => {
        let href = $(el).attr('href');
        if (href) {
          if (href.includes('uddg=')) {
            const matches = href.match(/uddg=([^&]+)/);
            if (matches && matches[1]) {
              href = decodeURIComponent(matches[1]);
            }
          }
          if (
            href.startsWith('http') &&
            !href.includes('duckduckgo.com') &&
            !urls.includes(href)
          ) {
            urls.push(href);
          }
        }
      });
    }
  } catch (err) {
    console.warn('[Auto-Search Agent] Web HTML search encountered an error:', err);
  }

  return urls.slice(0, maxResults);
}

/**
 * Scrapes clean, readable body text from a webpage using cheerio.
 */
async function scrapeUrlText(url: string): Promise<string | null> {
  try {
    console.log(`[Auto-Search Agent] 📄 Scraping content from: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ThereBot/1.0; Saudi DMC Discovery Agent)',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      console.warn(`[Auto-Search Agent] HTTP ${response.status} fetching ${url}`);
      return null;
    }

    const html = await response.text();
    const cheerio = await import('cheerio');
    const $ = cheerio.load(html);

    // Remove noise elements
    $('script, style, nav, footer, header, iframe, noscript, svg, [role="navigation"], aside').remove();

    const text = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 8000);

    return text.length >= 50 ? text : null;
  } catch (err) {
    console.warn(`[Auto-Search Agent] Failed scraping ${url}:`, err);
    return null;
  }
}

/**
 * POST /api/providers/auto-search
 *
 * Fully autonomous AI Sourcing loop:
 * 1. Takes a natural language query (e.g. "Find stargazing camps in AlUla")
 * 2. Searches the web for top candidate URLs
 * 3. Scrapes readable text from each URL using cheerio
 * 4. Extracts structured provider profiles with Groq LLM (llama-3.1-70b-versatile)
 * 5. Generates 384d vector embeddings via local @xenova/transformers
 * 6. Bulk inserts discovered providers into Supabase experience_providers table
 */
export async function POST(request: NextRequest) {
  try {
    let body: AutoSearchRequestBody;
    try {
      body = (await request.json()) as AutoSearchRequestBody;
    } catch {
      return NextResponse.json(
        { success: false, error: 'Invalid JSON request payload.' },
        { status: 400 }
      );
    }

    const query = body.query?.trim();
    if (!query || query.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Missing required field "query". Please provide a search term.',
        },
        { status: 400 }
      );
    }

    const maxResults = Math.min(Math.max(body.max_results || 3, 1), 5);
    const tenantId = await resolveTenantId(body.tenant_id);

    console.log(`[Auto-Search Agent] 🚀 Initiating autonomous loop for: "${query}" (Tenant: ${tenantId})`);

    // Step 1: Broad Web Search
    const targetUrls = await searchWeb(query, maxResults);

    if (targetUrls.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: `لم يتم العثور على نتائج بحث للطلب: "${query}". حاول إعادة صياغة البحث.`,
          urls_scraped: [],
          providers: [],
        },
        { status: 404 }
      );
    }

    console.log(`[Auto-Search Agent] 🎯 Found ${targetUrls.length} candidate URLs:`, targetUrls);

    // Step 2, 3, 4: Scrape -> Groq Extraction -> Local Xenova Embedding
    const discoveredProviders: Array<any> = [];
    const executionLogs: Array<{ url: string; status: string; reason?: string }> = [];

    for (const url of targetUrls) {
      try {
        const scrapedText = await scrapeUrlText(url);
        if (!scrapedText) {
          executionLogs.push({ url, status: 'skipped', reason: 'Empty or inaccessible page content' });
          continue;
        }

        console.log(`[Auto-Search Agent] 🧠 Extracting provider from ${url} (${scrapedText.length} chars)`);
        const extracted = await extractExperienceProvider(scrapedText);

        console.log(`[Auto-Search Agent] ⚡ Generating 384d local embedding for: ${extracted.name}`);
        const embedding = await generateProviderEmbedding(extracted);

        discoveredProviders.push({
          tenant_id: tenantId,
          name: extracted.name,
          city: extracted.city,
          experience_type: extracted.experience_type,
          capacity: extracted.capacity,
          verification_status: extracted.verification_status,
          phone_number: extracted.phone_number || null,
          phone: extracted.phone_number || null,
          embedding: JSON.stringify(embedding),
          source_url: url,
        });

        executionLogs.push({ url, status: 'extracted', reason: `Identified: ${extracted.name}` });
      } catch (loopError) {
        const errorMsg = loopError instanceof Error ? loopError.message : String(loopError);
        console.warn(`[Auto-Search Agent] Failed extracting from ${url}:`, errorMsg);
        executionLogs.push({ url, status: 'failed', reason: errorMsg });
      }
    }

    if (discoveredProviders.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'تم الوصول إلى المواقع لكن تعذر استخراج مزودي تجارب موثقين منها.',
          urls_scraped: targetUrls,
          logs: executionLogs,
          providers: [],
        },
        { status: 422 }
      );
    }

    // Step 5: Bulk insert into Supabase
    const supabase = createServerSupabaseClient();
    const rowsToInsert = discoveredProviders.map(({ source_url, ...rest }) => rest);

    const { data: insertedRecords, error: insertError } = await supabase
      .from('experience_providers')
      .insert(rowsToInsert)
      .select('id, tenant_id, name, city, experience_type, capacity, verification_status, phone_number, created_at');

    if (insertError) {
      console.error('[Auto-Search Agent] Supabase insertion error:', insertError);
      return NextResponse.json(
        {
          success: false,
          error: `Database insertion error: ${insertError.message}`,
          urls_scraped: targetUrls,
          logs: executionLogs,
        },
        { status: 500 }
      );
    }

    console.log(`[Auto-Search Agent] 🎉 Successfully saved ${insertedRecords?.length || 0} new providers!`);

    return NextResponse.json(
      {
        success: true,
        message: `تم اكتشاف وحفظ ${insertedRecords?.length || 0} مزود تجارب بنجاح!`,
        count: insertedRecords?.length || 0,
        providers: insertedRecords || [],
        urls_scraped: targetUrls,
        logs: executionLogs,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error('[Auto-Search Agent] Unexpected server error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error occurred.',
      },
      { status: 500 }
    );
  }
}
