import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { WebSocket as WSPolyfill } from "ws";

/**
 * Service-role client — ingestion + trusted server routes ONLY.
 * Bypasses RLS. Never import this from browser-reachable code.
 *
 * realtime.transport: supabase-js constructs its realtime client eagerly and
 * requires a WebSocket implementation. Node <22 has no native global
 * WebSocket, so we pass `ws` when the global is missing. (Node 22+ and
 * browsers use the native one; ingest never opens realtime channels anyway.)
 */
export function createServiceClient(url: string, serviceRoleKey: string): SupabaseClient {
  const transport = (globalThis as { WebSocket?: unknown }).WebSocket ?? WSPolyfill;
  return createClient(url, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    // supabase-js's WebSocketLike type differs slightly from ws's — safe cast.
    realtime: { transport: transport as never },
  });
}
