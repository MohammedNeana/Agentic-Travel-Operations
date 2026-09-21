import { createClient } from '@supabase/supabase-js';

export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error(
      'Missing Supabase environment variables. Check .env.local for NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.'
    );
  }

  return createClient(url, key, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

function extractToken(
  request?: Request | { headers: Headers | { get(key: string): string | null } }
): string | null {
  if (!request?.headers) return null;
  const authHeader = request.headers.get('authorization');
  if (authHeader?.startsWith('Bearer ')) {
    return authHeader.substring(7).trim();
  }
  const cookieHeader = request.headers.get('cookie');
  if (cookieHeader) {
    const match = cookieHeader.match(/sb-[a-zA-Z0-9_-]+-auth-token=([^;]+)/);
    if (match?.[1]) {
      try {
        const decoded = decodeURIComponent(match[1]);
        if (decoded.startsWith('base64-')) {
          const parsed = JSON.parse(Buffer.from(decoded.slice(7), 'base64').toString('utf-8'));
          return parsed?.access_token || parsed?.[0] || null;
        }
        const parsed = JSON.parse(decoded);
        return parsed?.access_token || parsed?.[0] || null;
      } catch {}
    }
  }
  return null;
}

export function createAuthenticatedServerClient(
  request?: Request | { headers: Headers | { get(key: string): string | null } }
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || (!anonKey && !serviceKey)) {
    throw new Error('Missing Supabase environment variables.');
  }

  const token = extractToken(request);
  if (token && anonKey) {
    return createClient(url, anonKey, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    });
  }

  const defaultKey = anonKey || serviceKey!;
  return createClient(url, defaultKey, {
    auth: { persistSession: false },
    global: {
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

export async function resolveAuthorizedTenantId(
  request: Request | { headers: Headers | { get(key: string): string | null } },
  requestedTenantId?: string
): Promise<string> {
  const supabase = createServerSupabaseClient();
  const token = extractToken(request);

  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user?.id) {
      const userMetaTenant = user.user_metadata?.tenant_id as string | undefined;
      if (userMetaTenant) {
        if (requestedTenantId && requestedTenantId !== userMetaTenant) {
          throw new Error('Tenant Authorization Forbidden: Cross-tenant operation blocked.');
        }
        return userMetaTenant;
      }

      const { data: profile } = await supabase
        .from('users')
        .select('tenant_id')
        .eq('id', user.id)
        .maybeSingle();

      if (profile?.tenant_id) {
        if (requestedTenantId && requestedTenantId !== profile.tenant_id) {
          throw new Error('Tenant Authorization Forbidden: Cross-tenant operation blocked.');
        }
        return profile.tenant_id;
      }
    }
  }

  const internalApiKey = request?.headers?.get('x-internal-api-key');
  const expectedSecret = process.env.INTERNAL_API_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (internalApiKey && expectedSecret && internalApiKey === expectedSecret) {
    if (requestedTenantId && requestedTenantId.trim().length > 0) {
      return requestedTenantId.trim();
    }
  }

  throw new Error('Tenant Authorization Required: A valid authenticated session is required to perform this action.');
}
