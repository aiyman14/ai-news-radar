import type { SupabaseClient } from "@supabase/supabase-js";
import type { SourceRow } from "../../types/db";
import type { SourceConfig } from "../../types/source";
import { isSourceType } from "../../types/source";
import { isKind, type Json } from "../../types/item";
import type { SourcesRepo } from "./types";

function rowToConfig(row: SourceRow): SourceConfig {
  if (!isSourceType(row.type)) {
    // Unknown type in the DB is a data bug, not an expected failure.
    throw new Error(`sources.${row.slug}: unknown source type '${row.type}'`);
  }
  return {
    id: row.id,
    slug: row.slug,
    type: row.type,
    name: row.name,
    url: row.url,
    config: (row.config ?? {}) as Record<string, Json>,
    trustScore: row.trust_score,
    defaultKindHint: isKind(row.default_kind_hint) ? row.default_kind_hint : null,
    enabled: row.enabled,
  };
}

export function createSourcesRepo(client: SupabaseClient): SourcesRepo {
  return {
    async listEnabled() {
      const { data, error } = await client
        .from("sources")
        .select("*")
        .eq("enabled", true)
        .order("slug");
      if (error) throw new Error(`sources.listEnabled failed: ${error.message}`);
      return ((data ?? []) as SourceRow[]).map(rowToConfig);
    },

    async getBySlugs(slugs: string[]) {
      if (slugs.length === 0) return [];
      const { data, error } = await client.from("sources").select("*").in("slug", slugs);
      if (error) throw new Error(`sources.getBySlugs failed: ${error.message}`);
      return ((data ?? []) as SourceRow[]).map(rowToConfig);
    },
  };
}
