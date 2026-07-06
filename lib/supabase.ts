import { createClient, SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

/**
 * Server-side Supabase client using the service-role key.
 * Never import this from client components.
 */
export function getSupabase(): SupabaseClient {
  if (!client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    // Prefer the service-role key; fall back to the anon key, which is
    // equivalent for this app while its tables have RLS disabled (single-user,
    // server-only DB access — see README).
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!url || !key) {
      throw new Error(
        'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY/SUPABASE_ANON_KEY — see .env.example'
      );
    }
    client = createClient(url, key, { auth: { persistSession: false } });
  }
  return client;
}
