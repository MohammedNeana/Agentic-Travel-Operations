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

  return 'a1b2c3d4-0001-4000-8000-000000000001'; //TODO: NO FALBACK
}

/**
 * Executes a broad web search using DuckDuckGo HTML parsing via cheerio
 * to retrieve top external candidate URLs.
 */
async function searchWeb(query: string, maxResults = 3): Promise<string[]> {
  const urls: string[] = [];

  try {
    const cheerio = await import('cheerio');
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
    console.log(`web search query: "${query}"`);

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
    console.warn('Web HTML search encountered an error:', err);
  }

  return urls.slice(0, maxResults);
}

/**
 * Normalizes and formats Saudi phone / WhatsApp numbers with +966 country code.
 */
function formatSaudiPhone(phone: string): string {
  const digits = phone.replace(/[^\d+]/g, '');
  if (digits.startsWith('+966')) return digits;
  if (digits.startsWith('00966')) return '+' + digits.slice(2);
  if (digits.startsWith('966')) return '+' + digits;
  if (digits.startsWith('05')) return '+966' + digits.slice(1);
  if (digits.startsWith('5') && digits.length === 9) return '+966' + digits;
  return digits.startsWith('+') ? digits : '+' + digits;
}

/**
 * Inspects a provider's official homepage or subpage for WhatsApp buttons,
 * tel: links, and Saudi mobile number patterns.
 */
async function extractPhoneFromWebsite(websiteUrl: string): Promise<string | null> {
  try {
    const cheerio = await import('cheerio');
    const res = await fetch(websiteUrl, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.9',
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return null;
    const html = await res.text();
    const $ = cheerio.load(html);

    // 1. Look for WhatsApp links (wa.me/966... or api.whatsapp.com/send?phone=...)
    let foundPhone: string | null = null;
    $('a[href*="wa.me"], a[href*="whatsapp.com"]').each((_, el) => {
      if (foundPhone) return;
      const href = $(el).attr('href') || '';
      const match = href.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/);
      if (match && match[1]) {
        foundPhone = match[1];
      }
    });

    if (foundPhone) return formatSaudiPhone(foundPhone);

    // 2. Look for tel: links
    $('a[href^="tel:"]').each((_, el) => {
      if (foundPhone) return;
      const tel = $(el).attr('href')?.replace(/^tel:/i, '').trim();
      if (tel && tel.replace(/[^\d]/g, '').length >= 8) {
        foundPhone = tel;
      }
    });

    if (foundPhone) return formatSaudiPhone(foundPhone);

    // 3. Scan HTML for Saudi mobile numbers
    const regexMatch = html.match(/(?:\+?966|00966|0)?5\d{8}\b/);
    if (regexMatch && regexMatch[0]) {
      return formatSaudiPhone(regexMatch[0]);
    }

    // 4. Crawl /contact or /contact-us subpage if not found on homepage
    let contactSubUrl: string | null = null;
    $('a').each((_, el) => {
      if (contactSubUrl) return;
      const href = $(el).attr('href') || '';
      if (/(?:contact|contact-us|اتصل|تواصل)/i.test(href)) {
        try {
          contactSubUrl = new URL(href, websiteUrl).href;
        } catch { }
      }
    });

    if (contactSubUrl && contactSubUrl !== websiteUrl) {
      const subRes = await fetch(contactSubUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
          Accept: 'text/html,application/xhtml+xml',
        },
        signal: AbortSignal.timeout(6000),
      });

      if (subRes.ok) {
        const subHtml = await subRes.text();
        const $sub = cheerio.load(subHtml);

        $sub('a[href*="wa.me"], a[href*="whatsapp.com"]').each((_, el) => {
          if (foundPhone) return;
          const href = $sub(el).attr('href') || '';
          const match = href.match(/(?:wa\.me\/|phone=)(\+?\d{8,15})/);
          if (match && match[1]) foundPhone = match[1];
        });
        if (foundPhone) return formatSaudiPhone(foundPhone);

        $sub('a[href^="tel:"]').each((_, el) => {
          if (foundPhone) return;
          const tel = $sub(el).attr('href')?.replace(/^tel:/i, '').trim();
          if (tel) foundPhone = tel;
        });
        if (foundPhone) return formatSaudiPhone(foundPhone);

        const subMatch = subHtml.match(/(?:\+?966|00966|0)?5\d{8}\b/);
        if (subMatch && subMatch[0]) return formatSaudiPhone(subMatch[0]);
      }
    }
  } catch (err) {
    console.warn(`[Auto-Search Agent] Could not inspect website ${websiteUrl}:`, err);
  }

  return null;
}

/**
 * Resolves the official website and WhatsApp/phone for a provider when the search
 * landed on an intermediary blog, magazine (e.g. TimeOut Riyadh), or directory.
 */
async function resolveProviderOfficialContact(
  providerName: string,
  city: string,
  articleHtml?: string
): Promise<string | null> {
  const cheerio = await import('cheerio');

  // Strategy 1: Look for external official website links in the article HTML
  if (articleHtml) {
    const $ = cheerio.load(articleHtml);
    const candidateUrls: string[] = [];

    const nameTokens = providerName
      .toLowerCase()
      .split(/[\s_-]+/)
      .filter((t) => t.length >= 3 && !['and', 'the', 'for', 'في', 'من', 'إلى', 'رحلات', 'مخيم', 'شركة'].includes(t));

    $('a').each((_, el) => {
      const href = $(el).attr('href');
      if (!href || !href.startsWith('http')) return;
      try {
        const parsed = new URL(href);
        const hostname = parsed.hostname.toLowerCase();
        if (
          hostname.includes('facebook') ||
          hostname.includes('twitter') ||
          hostname.includes('instagram') ||
          hostname.includes('timeout') ||
          hostname.includes('google') ||
          hostname.includes('tripadvisor') ||
          hostname.includes('ootlah') ||
          hostname.includes('travomint')
        ) {
          return;
        }

        const matchesName = nameTokens.some((tok) => hostname.includes(tok) || parsed.pathname.toLowerCase().includes(tok));
        if (matchesName && !candidateUrls.includes(href)) {
          candidateUrls.push(href);
        }
      } catch { }
    });

    for (const officialUrl of candidateUrls.slice(0, 2)) {
      console.log(`Found official provider link from article: ${officialUrl}`);
      const phone = await extractPhoneFromWebsite(officialUrl);
      if (phone) return phone;
    }
  }

  // Strategy 2: Autonomous targeted search for the provider's direct website & WhatsApp
  try {
    const targetedQuery = `"${providerName}" ${city} واتساب هاتف موقع`;
    console.log(`targeted search: "${targetedQuery}"`);
    const directUrls = await searchWeb(targetedQuery, 2);

    for (const directUrl of directUrls) {
      console.log(`Inspecting targeted website for WhatsApp/phone: ${directUrl}`);
      const phone = await extractPhoneFromWebsite(directUrl);
      if (phone) return phone;
    }
  } catch (err) {
    console.warn(`Targeted search error for ${providerName}:`, err);
  }

  return null;
}

/**
 * Scrapes clean readable text and contact details from a webpage using cheerio.
 */
async function scrapeUrlText(
  url: string
): Promise<{ text: string; rawHtml: string; contactPhones: string[] } | null> {
  try {
    console.log(`Scraping content from: ${url}`);
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.9',
      },
      signal: AbortSignal.timeout(12000),
    });

    if (!response.ok) {
      console.warn(`HTTP ${response.status} fetching ${url}`);
      return null;
    }

    const html = await response.text();
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

    // 2. If no phone found on landing page, check /contact-us subpage
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
            contactPageUrl = new URL(href, url).href;
          } catch { }
        }
      });

      if (contactPageUrl && contactPageUrl !== url) {
        console.log(`Crawling contact subpage: ${contactPageUrl}`);
        try {
          const contactRes = await fetch(contactPageUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
              Accept: 'text/html,application/xhtml+xml',
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
          console.warn(`Contact subpage crawl failed for ${contactPageUrl}:`, contactErr);
        }
      }
    }

    // 3. Remove script and style elements
    $('script, style, iframe, noscript, svg').remove();

    let text = $('body')
      .text()
      .replace(/\s+/g, ' ')
      .replace(/\n{3,}/g, '\n\n')
      .trim()
      .slice(0, 8000);

    const contactPhoneList = Array.from(contactNumbers);
    if (contactPhoneList.length > 0) {
      console.log(`Discovered contact numbers for ${url}:`, contactPhoneList.join(' | '));
      text += `\n\n--- بيانات التواصل وأرقام الهواتف والواتساب المكتشفة ---\nرقم هاتف / واتساب للتواصل: ${contactPhoneList.join(' | ')}`;
    }

    if (text.length < 50) return null;

    return {
      text,
      rawHtml: html,
      contactPhones: contactPhoneList,
    };
  } catch (err) {
    console.warn(`Failed scraping ${url}:`, err);
    return null;
  }
}


//TODO: NEED TO TAKE THE natural language query and pass to the AI model to provide the system with the correct query
/**
 * POST /api/providers/auto-search
 *
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

    console.log(`loop for: "${query}" (Tenant: ${tenantId})`);

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

    console.log(`Found ${targetUrls.length} candidate URLs:`, targetUrls);

    // Step 2, 3, 4: Scrape -> Groq Extraction -> Local Xenova Embedding
    const discoveredProviders: Array<any> = [];
    const executionLogs: Array<{ url: string; status: string; reason?: string }> = [];

    for (const url of targetUrls) {
      try {
        const scraped = await scrapeUrlText(url);
        if (!scraped) {
          executionLogs.push({ url, status: 'skipped', reason: 'Empty or inaccessible page content' });
          continue;
        }

        console.log(`Extracting provider from ${url} (${scraped.text.length} chars)`);
        const extracted = await extractExperienceProvider(scraped.text);

        // Targeted Official Website & WhatsApp Resolution:
        if (!extracted.phone_number) {
          if (scraped.contactPhones.length > 0) {
            extracted.phone_number = formatSaudiPhone(scraped.contactPhones[0]);
            console.log(`discovered phone for "${extracted.name}":`, extracted.phone_number);
          } else {
            console.log(`Phone missing for "${extracted.name}". Inspecting official website / WhatsApp...`);
            const resolvedPhone = await resolveProviderOfficialContact(extracted.name, extracted.city, scraped.rawHtml);
            if (resolvedPhone) {
              extracted.phone_number = resolvedPhone;
              console.log(`Successfully resolved official phone for "${extracted.name}":`, resolvedPhone);
            }
          }
        }

        console.log(`Generating 384d local embedding for: ${extracted.name}`);
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

        executionLogs.push({
          url,
          status: 'extracted',
          reason: `Identified: ${extracted.name} (${extracted.phone_number || 'No phone'})`,
        });

        // 1.2s pause between candidate evaluations to prevent token rate limits on free Groq tier
        await new Promise((resolve) => setTimeout(resolve, 1200));
      } catch (loopError) {
        const errorMsg = loopError instanceof Error ? loopError.message : String(loopError);
        console.warn(`Failed extracting from ${url}:`, errorMsg);
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
      console.error('Supabase insertion error:', insertError);
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

    console.log(`Successfully saved ${insertedRecords?.length || 0} new providers!`);

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
    console.error('Unexpected server error:', error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Internal server error occurred.',
      },
      { status: 500 }
    );
  }
}
