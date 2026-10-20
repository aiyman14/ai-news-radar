import { Suspense } from "react";
import { getSnapshot } from "../../lib/data";
import { sourceOptions } from "../../lib/queries";
import { SEARCH_INDEX_URL } from "../../lib/site";
import { SearchClient } from "../../components/SearchClient";

/**
 * Search — the only interactive page. The shell is static; the client
 * component reads the query string and filters the static index in the
 * browser. Suspense is required for useSearchParams in a static export.
 */
export default async function SearchPage() {
  const snapshot = await getSnapshot();
  return (
    <Suspense fallback={<p className="text-sm text-faint">Loading…</p>}>
      <SearchClient indexUrl={SEARCH_INDEX_URL} sources={sourceOptions(snapshot)} />
    </Suspense>
  );
}
