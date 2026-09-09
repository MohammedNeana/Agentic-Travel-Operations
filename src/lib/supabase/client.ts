import { createClient } from '@supabase/supabase-js';

/**
 * Browser-side Supabase client for use in Client Components.
 * Uses the publishable anon key.
 */
export function createBrowserSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  return createClient(url, key);
}
