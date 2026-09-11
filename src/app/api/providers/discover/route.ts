import { NextRequest, NextResponse } from 'next/server';
import { extractExperienceProvider } from '@/lib/ai/extraction';
import { generateProviderEmbedding } from '@/lib/ai/embeddings';
import { createServerSupabaseClient } from '@/lib/supabase/server';

export const dynamic = 'force-dynamic';

interface DiscoverRequestBody {
  text_content?: string;
  url?: string;
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
 * Ingests scraped text or a URL of a Saudi experience provider page.
 * Performs structured AI extraction via Groq LLM (llama-3.1-70b-versatile),
 * generates a 384-dimensional embedding using local @xenova/transformers,
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

    let textContent = body.text_content?.trim() || '';
    const targetUrl = body.url?.trim() || '';

    // If a URL is provided, scrape it with cheerio
    if (targetUrl) {
      try {
        console.log(`[Web Agent] 🌐 Scraping URL: ${targetUrl}`);
        const scrapeResponse = await fetch(targetUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (compatible; ThereBot/1.0; DMC Discovery Agent)',
            'Accept': 'text/html,application/xhtml+xml',
            'Accept-Language': 'ar,en;q=0.9',
          },
          signal: AbortSignal.timeout(15000),
        });

        if (!scrapeResponse.ok) {
          return NextResponse.json(
            {
              success: false,
              error: `Failed to fetch URL (HTTP ${scrapeResponse.status}): ${scrapeResponse.statusText}`,
            },
            { status: 400 }
          );
        }

        const html = await scrapeResponse.text();

        // Use cheerio to extract clean readable text and contact details
        const cheerio = await import('cheerio');
        const $ = cheerio.load(html);

        // 1. Extract contact phones & WhatsApp links from the entire DOM
        const contactNumbers = new Set<string>();

        $('a[href^="tel:"]').each((_, el) => {
          const tel = $(el).attr('href')?.replace(/^tel:/i, '').trim();
          if (tel) contactNumbers.add(tel);
        });

        $('a[href*="wa.me"], a[href*="whatsapp.com"]').each((_, el) => {
          const href = $(el).attr('href') || '';
          const match = href.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/);
          if (match && match[1]) contactNumbers.add(match[1]);
        });

        const regexPhones = html.match(/(?:\+?966|00966|0)?5\d{8}\b/g);
        if (regexPhones) {
          for (const p of regexPhones) contactNumbers.add(p);
        }

        // 2. If no phone found on landing page, autonomously discover and crawl the /contact-us subpage
        if (contactNumbers.size === 0) {
          let contactPageUrl: string | null = null;
          $('a').each((_, el) => {
            if (contactPageUrl) return;
            const href = $(el).attr('href');
            const text = $(el).text().toLowerCase();
            if (!href) return;

            if (
              /(?:contact|contact-us|contact_us|اتصل|تواصل)/i.test(href) ||
              /(?:اتصل بنا|تواصل معنا|اتصل|contact us|contact)/i.test(text)
            ) {
              try {
                contactPageUrl = new URL(href, targetUrl).href;
              } catch {
                // Invalid relative URL
              }
            }
          });

          if (contactPageUrl && contactPageUrl !== targetUrl) {
            console.log(`[Web Agent] 📞 Crawling contact subpage: ${contactPageUrl}`);
            try {
              const contactRes = await fetch(contactPageUrl, {
                headers: {
                  'User-Agent': 'Mozilla/5.0 (compatible; ThereBot/1.0; DMC Discovery Agent)',
                  Accept: 'text/html,application/xhtml+xml',
                  'Accept-Language': 'ar,en;q=0.9',
                },
                signal: AbortSignal.timeout(8000),
              });

              if (contactRes.ok) {
                const contactHtml = await contactRes.text();
                const $c = cheerio.load(contactHtml);

                $c('a[href^="tel:"]').each((_, el) => {
                  const tel = $c(el).attr('href')?.replace(/^tel:/i, '').trim();
                  if (tel) contactNumbers.add(tel);
                });

                $c('a[href*="wa.me"], a[href*="whatsapp.com"]').each((_, el) => {
                  const href = $c(el).attr('href') || '';
                  const match = href.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/);
                  if (match && match[1]) contactNumbers.add(match[1]);
                });

                const subPhones = contactHtml.match(/(?:\+?966|00966|0)?5\d{8}\b/g);
                if (subPhones) {
                  for (const p of subPhones) contactNumbers.add(p);
                }
              }
            } catch (contactErr) {
              console.warn(`[Web Agent] Contact subpage crawl failed:`, contactErr);
            }
          }
        }

        // 3. Remove scripts and styles
        $('script, style, iframe, noscript, svg').remove();

        // Extract clean text from body
        let scrapedText = $('body').text()
          .replace(/\s+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 8000);

        if (contactNumbers.size > 0) {
          const phoneList = Array.from(contactNumbers).join(' | ');
          console.log(`[Web Agent] 📱 Discovered contact numbers:`, phoneList);
          scrapedText += `\n\n--- بيانات التواصل وأرقام الهواتف والواتساب المكتشفة ---\nرقم هاتف / واتساب للتواصل: ${phoneList}`;
        }

        console.log(`[Web Agent] ✅ Scraped ${scrapedText.length} chars from ${targetUrl}`);

        // Combine: scraped text takes priority, append any additional manual text
        textContent = textContent
          ? `${scrapedText}\n\n---\nAdditional context:\n${textContent}`
          : scrapedText;
      } catch (scrapeError) {
        const message = scrapeError instanceof Error ? scrapeError.message : 'Unknown scraping error';
        return NextResponse.json(
          { success: false, error: `URL scraping failed: ${message}` },
          { status: 400 }
        );
      }
    }

    // Validate we have text content (from textarea or scraped URL)
    if (!textContent || textContent.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Provide either "text_content" or a "url" to scrape.',
        },
        { status: 400 }
      );
    }

    // 1. Structured AI Extraction via Groq LLM (Zod verified)
    const extracted = await extractExperienceProvider(textContent);

    // 2. Vector Embedding Generation (384-dim local @xenova/transformers)
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
        phone_number: extracted.phone_number || null,
        phone: extracted.phone_number || null,
        embedding: JSON.stringify(embedding), // Format for pgvector column
      })
      .select('id, tenant_id, name, city, experience_type, capacity, verification_status, phone_number, created_at')
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
        source: targetUrl ? 'url_scrape' : 'text_input',
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
