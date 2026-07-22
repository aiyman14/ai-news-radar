import type { SupabaseClient } from "@supabase/supabase-js";
import type { RunsRepo } from "./types";

export function createRunsRepo(client: SupabaseClient): RunsRepo {
  return {
    async start(trigger) {
      const { data, error } = await client
        .from("ingestion_runs")
        .insert({ trigger, status: "running" })
        .select("id")
        .single();
      if (error) throw new Error(`ingestion_runs.start failed: ${error.message}`);
      return (data as { id: string }).id;
    },

    async finish(runId, patch) {
      const { error } = await client
        .from("ingestion_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: patch.status,
          items_fetched: patch.itemsFetched,
          items_new: patch.itemsNew,
          items_failed: patch.itemsFailed,
          notes: patch.notes ?? null,
        })
        .eq("id", runId);
      if (error) throw new Error(`ingestion_runs.finish failed: ${error.message}`);
    },
  };
}
