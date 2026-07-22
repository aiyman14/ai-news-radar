import { createServerSupabase } from "../../lib/supabase-server";
import { fetchFeedPage } from "../../lib/queries";
import { ItemRow } from "../../components/ItemRow";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState } from "../../components/EmptyState";
import { SearchBox } from "../../components/SearchBox";

export const dynamic = "force-dynamic";

/** New tools & launches — kind IN (tool, launch), with `?q=` FTS. */
export default async function ToolsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const supabase = await createServerSupabase();
  const { items, total, error } = await fetchFeedPage(supabase, {
    kinds: ["tool", "launch"],
    q: q || undefined,
  });

  return (
    <section>
      <SectionHeader
        title="Tools & launches"
        description="Kind: tool · launch"
        count={q ? total : undefined}
      >
        <SearchBox action="/tools" q={q} placeholder="Search tools…" clearHref="/tools" />
      </SectionHeader>
      {error && <p className="text-sm text-kind-opinion">Error: {error}</p>}
      {!error && items.length === 0 && (
        <EmptyState
          title={q ? "No tools match" : "No tools or launches yet"}
          hint={q ? "Try a broader search." : undefined}
        />
      )}
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
    </section>
  );
}
