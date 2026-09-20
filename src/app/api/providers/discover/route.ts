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

  throw new Error('Tenant ID could not be resolved from active session or database.');
}

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

    if (targetUrl) {
      try {
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

        const cheerio = await import('cheerio');
        const $ = cheerio.load(html);

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
              } catch {}
            }
          });

          if (contactPageUrl && contactPageUrl !== targetUrl) {
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
            } catch {}
          }
        }

        $('script, style, iframe, noscript, svg').remove();

        let scrapedText = $('body').text()
          .replace(/\s+/g, ' ')
          .replace(/\n{3,}/g, '\n\n')
          .trim()
          .slice(0, 8000);

        if (contactNumbers.size > 0) {
          const phoneList = Array.from(contactNumbers).join(' | ');
          scrapedText += `\n\n--- بيانات التواصل وأرقام الهواتف والواتساب المكتشفة ---\nرقم هاتف / واتساب للتواصل: ${phoneList}`;
        }

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

    if (!textContent || textContent.length === 0) {
      return NextResponse.json(
        {
          success: false,
          error: 'Provide either "text_content" or a "url" to scrape.',
        },
        { status: 400 }
      );
    }

    const extracted = await extractExperienceProvider(textContent);
    const embedding = await generateProviderEmbedding(extracted);
    const tenantId = await resolveTenantId(body.tenant_id);

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
        embedding: JSON.stringify(embedding),
      })
      .select('id, tenant_id, name, city, experience_type, capacity, verification_status, phone_number, created_at')
      .single();

    if (insertError || !insertedProvider) {
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
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error occurred.',
      },
      { status: 500 }
    );
  }
}
