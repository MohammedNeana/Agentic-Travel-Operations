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

export function createAuthenticatedServerClient(
  request?: Request | { headers: Headers | { get(key: string): string | null } }
) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || (!anonKey && !serviceKey)) {
    throw new Error('Missing Supabase environment variables.');
  }

  const authHeader = request?.headers?.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  if (token && anonKey) {
    return createClient(url, anonKey, {
      auth: { persistSession: false },
      global: {
        headers: { Authorization: `Bearer ${token}` },
        fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
      },
    });
  }

  const defaultKey = serviceKey || anonKey!;
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
  const authHeader = request?.headers?.get('authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.substring(7).trim() : null;

  if (token) {
    const { data: { user } } = await supabase.auth.getUser(token);
    if (user?.id) {
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

  const { data } = await supabase
    .from('organizations')
    .select('tenant_id')
    .limit(1)
    .maybeSingle();
  const org = data as { tenant_id?: string } | null;

  if (org?.tenant_id) {
    if (requestedTenantId && requestedTenantId !== org.tenant_id) {
      throw new Error('Tenant Authorization Forbidden: Cross-tenant operation blocked.');
    }
    return org.tenant_id;
  }

  if (requestedTenantId && requestedTenantId.trim().length > 0) {
    return requestedTenantId.trim();
  }

  throw new Error('Tenant ID could not be resolved from active session or database.');
}
