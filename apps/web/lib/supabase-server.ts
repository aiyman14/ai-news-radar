import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} must be set (see .env.example)`);
  return value;
}

/**
 * Anonymous server client — the dashboard is PUBLIC-READ, so every page
 * queries through the anon key and RLS's anon SELECT policies. There is no
 * auth, no session, no cookie handling; the service-role key is never used
 * by the web app.
 */
export function createServerSupabase(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"),
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
}
