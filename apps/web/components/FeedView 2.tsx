import Link from "next/link";
import { getSnapshot } from "../lib/data";
import { allCards, cardsOfKinds, topStories } from "../lib/queries";
import { paginate } from "../lib/filter";
import { kindLabel } from "../lib/kinds";
import { SEARCH_PATH } from "../lib/feed-params";
import { ItemRow } from "./ItemRow";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { SearchBox } from "./SearchBox";
import { KindTabs } from "./KindTabs";
import { Pagination } from "./Pagination";
import { TopStoriesStrip } from "./TopStoriesStrip";

/** Static route for a feed page: "/", "/page/2", "/kind/news", "/kind/news/page/2". */
export function feedPageHref(kind: string | undefined, page: number): string {
  const base = kind ? `/kind/${kind}` : "";
  return page > 1 ? `${base}/page/${page}` : base || "/";
}

/** Number of static pages a feed (all or one kind) needs. */
export async function feedPageCount(kind?: string): Promise<number> {
  const snapshot = await getSnapshot();
  const cards = kind ? cardsOfKinds(snapshot, [kind]) : allCards(snapshot);
  return paginate(cards, 1).totalPages;
}

/**
 * The feed river, pre-rendered at build time. Kind tabs and pagination are
 * static pages; anything combinatorial (search, source, date range, …)
 * lives on /search and runs in the browser.
 */
export async function FeedView({ kind, page }: { kind?: string; page: number }) {
  const snapshot = await getSnapshot();
  const cards = kind ? cardsOfKinds(snapshot, [kind]) : allCards(snapshot);
  const result = paginate(cards, page);
  const showStrip = !kind && page === 1;
  const strip = showStrip ? topStories(snapshot) : null;

  return (
    <section>
      <SectionHeader
        title={kind ? kindLabel(kind) : "Feed"}
        description={kind ? `Kind: ${kind}` : "Latest across all sources"}
        count={result.total}
      >
        <SearchBox
          action={SEARCH_PATH}
          q=""
          placeholder="Search the feed…"
          clearHref={SEARCH_PATH}
          hidden={kind ? { kind } : {}}
        />
      </SectionHeader>

      {strip && <TopStoriesStrip stories={strip.stories} windowHours={strip.windowHours} />}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <KindTabs active={kind ? [kind] : []} hrefFor={(k) => feedPageHref(k, 1)} allHref="/" />
        <Link
          href={kind ? `${SEARCH_PATH}?kind=${kind}` : SEARCH_PATH}
          className="text-xs text-faint underline hover:text-fg"
        >
          More filters →
        </Link>
      </div>

      {result.items.length === 0 && (
        <EmptyState
          title="No items yet"
          hint="The daily ingestion hasn't run against this build. Run `pnpm ingest` and rebuild."
        />
      )}
      <ul>
        {result.items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      <Pagination
        page={result.page}
        totalPages={result.totalPages}
        hrefFor={(p) => feedPageHref(kind, p)}
      />
    </section>
  );
}
