import { createClient } from '@supabase/supabase-js';

/**
 * Server-side Supabase client for use in Server Components and Route Handlers.
 * Uses the anon key with dev-only open-read RLS policies.
 *
 * TODO: Replace with service role key or proper auth session forwarding
 * when Supabase Auth is integrated.
 */
export function createServerSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

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
