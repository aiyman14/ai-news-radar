import type { SupabaseClient } from "@supabase/supabase-js";
import type { Repositories } from "./types";
import { createSourcesRepo } from "./sources";
import { createRunsRepo } from "./runs";
import { createItemsRepo } from "./items";
import { createErrorsRepo } from "./errors";
import { createClustersRepo } from "./clusters";
import { createIntelligenceRepo } from "./intelligence";

export function createSupabaseRepositories(client: SupabaseClient): Repositories {
  return {
    sources: createSourcesRepo(client),
    runs: createRunsRepo(client),
    items: createItemsRepo(client),
    errors: createErrorsRepo(client),
    clusters: createClustersRepo(client),
    intelligence: createIntelligenceRepo(client),
  };
}

export * from "./types";
export { createInMemoryRepositories, type MemoryStores } from "./memory";
export { createClustersRepo } from "./clusters";
export { createIntelligenceRepo } from "./intelligence";
