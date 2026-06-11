import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseEnv } from "@/lib/env";

/**
 * Service-role Supabase client. Server-only — bypasses RLS, so it must never be
 * imported into a client component. Used here exclusively to read/write the
 * `onedrive_connections` table, which is locked to the service role (RLS on,
 * no public policies). See supabase/migrations/0001_onedrive_connections.sql.
 */
let cached: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (cached) return cached;
  const env = getSupabaseEnv();
  cached = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cached;
}
