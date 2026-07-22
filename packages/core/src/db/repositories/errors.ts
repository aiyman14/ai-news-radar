import type { SupabaseClient } from "@supabase/supabase-js";
import type { ErrorsRepo } from "./types";

export function createErrorsRepo(client: SupabaseClient): ErrorsRepo {
  return {
    async record(entry) {
      const { error } = await client.from("source_errors").insert({
        run_id: entry.runId,
        source_id: entry.sourceId,
        phase: entry.phase,
        message: entry.message,
        detail: entry.detail === undefined ? null : JSON.parse(JSON.stringify(entry.detail)),
      });
      // Recording an error must never crash the run — log-and-continue.
      if (error) {
        console.error(`source_errors.record failed: ${error.message}`);
      }
    },
  };
}
