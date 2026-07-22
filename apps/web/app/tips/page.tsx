import { createServerSupabase } from "../../lib/supabase-server";
import { fetchFeedPage } from "../../lib/queries";
import { ItemRow } from "../../components/ItemRow";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState } from "../../components/EmptyState";
import { SearchBox } from "../../components/SearchBox";

export const dynamic = "force-dynamic";

/** Tips & tricks — kind = tip, with `?q=` FTS. */
export default async function TipsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const q = ((await searchParams).q ?? "").trim();
  const supabase = await createServerSupabase();
  const { items, total, error } = await fetchFeedPage(supabase, {
    kinds: ["tip"],
    q: q || undefined,
  });

  return (
    <section>
      <SectionHeader
        title="Tips & tricks"
        description="Kind: tip"
        count={q ? total : undefined}
      >
        <SearchBox action="/tips" q={q} placeholder="Search tips…" clearHref="/tips" />
      </SectionHeader>
      {error && <p className="text-sm text-kind-opinion">Error: {error}</p>}
      {!error && items.length === 0 && (
        <EmptyState
          title={q ? "No tips match" : "No tips yet"}
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
