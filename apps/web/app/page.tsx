import Link from "next/link";
import { createServerSupabase } from "../lib/supabase-server";
import { fetchAllSources, fetchFeedPage, fetchTopStories } from "../lib/queries";
import {
  feedHref,
  hasActiveFilters,
  parseFeedParams,
  RANGE_HOURS,
  RANGE_LABEL,
  toggleKindHref,
  type FeedParams,
  type RawSearchParams,
} from "../lib/feed-params";
import { KINDS, kindChipClass, kindLabel } from "../lib/kinds";
import { CHIP, CHIP_NEUTRAL } from "../lib/ui";
import { ItemRow } from "../components/ItemRow";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/EmptyState";
import { SearchBox } from "../components/SearchBox";
import { FilterControls } from "../components/FilterControls";
import { TopStoriesStrip } from "../components/TopStoriesStrip";

export const dynamic = "force-dynamic";

const INACTIVE_CHIP = `${CHIP} border-border bg-transparent text-muted hover:border-accent/40 hover:text-fg`;

/** Kind tabs for the river — All + the 7 kinds, multi-select. */
function KindTabs({ params }: { params: FeedParams }) {
  const allActive = params.kinds.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link
        href={feedHref(params, { kinds: [] })}
        className={
          allActive ? `${CHIP} border-accent/40 bg-accent/15 text-accent` : INACTIVE_CHIP
        }
      >
        All
      </Link>
      {KINDS.map((kind) => (
        <Link
          key={kind}
          href={toggleKindHref(params, kind)}
          className={params.kinds.includes(kind) ? `${CHIP} ${kindChipClass(kind)}` : INACTIVE_CHIP}
        >
          {kindLabel(kind)}
        </Link>
      ))}
    </div>
  );
}

/** Active filters as removable chips. */
function ActiveFilters({
  params,
  sourceName,
}: {
  params: FeedParams;
  sourceName: string | null;
}) {
  const chips: Array<{ label: string; href: string }> = [];
  if (params.q) chips.push({ label: `“${params.q}”`, href: feedHref(params, { q: "" }) });
  if (params.source && sourceName)
    chips.push({ label: sourceName, href: feedHref(params, { source: "" }) });
  if (params.range)
    chips.push({
      label: RANGE_LABEL[params.range] ?? params.range,
      href: feedHref(params, { range: "" }),
    });
  if (params.img) chips.push({ label: "Has image", href: feedHref(params, { img: false }) });
  if (params.clustered)
    chips.push({ label: "In a story", href: feedHref(params, { clustered: false }) });
  if (params.tag) chips.push({ label: `#${params.tag}`, href: feedHref(params, { tag: "" }) });
  if (params.entity)
    chips.push({ label: `@${params.entity}`, href: feedHref(params, { entity: "" }) });
  if (chips.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-faint">Filters:</span>
      {chips.map(({ label, href }) => (
        <Link
          key={href}
          href={href}
          className={`${CHIP_NEUTRAL} hover:border-accent/40 hover:text-fg`}
          title="Remove filter"
        >
          {label} <span aria-hidden>✕</span>
        </Link>
      ))}
      <Link href="/" className="text-xs text-faint underline hover:text-fg">
        clear all
      </Link>
    </div>
  );
}

/** FEED — the river: searched/filtered server-side, all state in the URL. */
export default async function FeedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = parseFeedParams(await searchParams);
  const filtering = hasActiveFilters(params);

  // The strip renders on the default view only (page 1, no search/filters) —
  // it would be noise on a filtered/search result.
  const showStrip = !filtering && params.page === 1;

  const supabase = await createServerSupabase();
  const [{ items, hasMore, total, error }, { sources }, topStories] = await Promise.all([
    fetchFeedPage(supabase, {
      q: params.q || undefined,
      kinds: params.kinds.length > 0 ? params.kinds : undefined,
      sourceId: params.source || undefined,
      sinceHours: RANGE_HOURS[params.range],
      hasImage: params.img || undefined,
      clusteredOnly: params.clustered || undefined,
      tag: params.tag || undefined,
      entity: params.entity || undefined,
      page: params.page,
    }),
    fetchAllSources(supabase),
    showStrip
      ? fetchTopStories(supabase)
      : Promise.resolve({ stories: [], windowHours: 24, error: null }),
  ]);
  const sourceName = sources.find((s) => s.id === params.source)?.name ?? null;

  return (
    <section>
      <SectionHeader
        title="Feed"
        description="Latest across all sources"
        count={filtering ? total : undefined}
      >
        <SearchBox
          action="/"
          q={params.q}
          placeholder="Search the feed…"
          clearHref={feedHref(params, { q: "" })}
          hidden={{
            kind: params.kinds.join(","),
            source: params.source,
            range: params.range,
            img: params.img ? "1" : "",
            clustered: params.clustered ? "1" : "",
            tag: params.tag,
            entity: params.entity,
          }}
        />
      </SectionHeader>

      {showStrip && (
        <TopStoriesStrip stories={topStories.stories} windowHours={topStories.windowHours} />
      )}

      <div className="mb-4 space-y-2.5">
        <KindTabs params={params} />
        <FilterControls
          params={params}
          sources={sources.map(({ id, name }) => ({ id, name }))}
        />
        <ActiveFilters params={params} sourceName={sourceName} />
      </div>

      {error && <p className="text-sm text-kind-opinion">Error loading items: {error}</p>}
      {!error && items.length === 0 && params.page === 1 && (
        <EmptyState
          title={filtering ? "No items match" : "No items yet"}
          hint={
            filtering
              ? "Try removing a filter or broadening the search."
              : "Run an ingestion to fill the feed."
          }
        />
      )}
      {!error && items.length === 0 && params.page > 1 && <EmptyState title="No more items" />}
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      <p className="mt-4 flex gap-4 text-sm text-muted">
        {params.page > 1 && (
          <Link className="hover:text-accent" href={feedHref(params, { page: params.page - 1 })}>
            ← Newer
          </Link>
        )}
        {hasMore && (
          <Link className="hover:text-accent" href={feedHref(params, { page: params.page + 1 })}>
            Older →
          </Link>
        )}
      </p>
    </section>
  );
}
