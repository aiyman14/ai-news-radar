"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import type { ItemCard } from "../lib/item-card";
import { filterItems, paginate } from "../lib/filter";
import {
  feedHref,
  hasActiveFilters,
  parseFeedParams,
  RANGE_HOURS,
  RANGE_LABEL,
  SEARCH_PATH,
  toggleKindHref,
  type FeedParams,
} from "../lib/feed-params";
import { CHIP_NEUTRAL } from "../lib/ui";
import { ItemRow } from "./ItemRow";
import { SectionHeader } from "./SectionHeader";
import { EmptyState } from "./EmptyState";
import { SearchBox } from "./SearchBox";
import { FilterControls } from "./FilterControls";
import { KindTabs } from "./KindTabs";
import { Pagination } from "./Pagination";

interface SearchIndex {
  generatedAt: string;
  items: ItemCard[];
}

// One fetch per page load, shared across navigations within the search page.
let indexPromise: Promise<SearchIndex> | null = null;
function loadIndex(url: string): Promise<SearchIndex> {
  indexPromise ??= fetch(url).then((r) => {
    if (!r.ok) throw new Error(`search index: HTTP ${r.status}`);
    return r.json() as Promise<SearchIndex>;
  });
  return indexPromise;
}

/** Active filters as removable chips. */
function ActiveFilters({ params, sourceName }: { params: FeedParams; sourceName: string | null }) {
  const chips: Array<{ label: string; href: string }> = [];
  if (params.q) chips.push({ label: `“${params.q}”`, href: feedHref(params, { q: "" }) });
  if (params.source && sourceName) chips.push({ label: sourceName, href: feedHref(params, { source: "" }) });
  if (params.range) chips.push({ label: RANGE_LABEL[params.range] ?? params.range, href: feedHref(params, { range: "" }) });
  if (params.img) chips.push({ label: "Has image", href: feedHref(params, { img: false }) });
  if (params.clustered) chips.push({ label: "In a story", href: feedHref(params, { clustered: false }) });
  if (params.tag) chips.push({ label: `#${params.tag}`, href: feedHref(params, { tag: "" }) });
  if (params.entity) chips.push({ label: `@${params.entity}`, href: feedHref(params, { entity: "" }) });
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
      <Link href={SEARCH_PATH} className="text-xs text-faint underline hover:text-fg">
        clear all
      </Link>
    </div>
  );
}

/**
 * Search + filters, resolved in the browser over the static index. All
 * state is in the URL (shareable, back-button-safe); the index is fetched
 * once per page load.
 */
export function SearchClient({
  indexUrl,
  sources,
}: {
  indexUrl: string;
  sources: Array<{ id: string; name: string }>;
}) {
  const searchParams = useSearchParams();
  const params = useMemo(() => parseFeedParams(new URLSearchParams(searchParams.toString())), [searchParams]);

  const [index, setIndex] = useState<SearchIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadIndex(indexUrl).then(setIndex, (e: Error) => setError(e.message));
  }, [indexUrl]);

  const result = useMemo(() => {
    if (!index) return null;
    const filtered = filterItems(index.items, {
      q: params.q || undefined,
      kinds: params.kinds,
      sourceId: params.source || undefined,
      sinceHours: RANGE_HOURS[params.range],
      hasImage: params.img || undefined,
      clusteredOnly: params.clustered || undefined,
      tag: params.tag || undefined,
      entity: params.entity || undefined,
    });
    return paginate(filtered, params.page);
  }, [index, params]);

  const filtering = hasActiveFilters(params);
  const sourceName = sources.find((s) => s.id === params.source)?.name ?? null;

  return (
    <section>
      <SectionHeader
        title="Search"
        description="Search and filter everything in the current radar"
        count={result && filtering ? result.total : undefined}
      >
        <SearchBox
          action={SEARCH_PATH}
          q={params.q}
          placeholder="Search titles, sources, tags…"
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

      <div className="mb-4 space-y-2.5">
        <KindTabs
          active={params.kinds}
          hrefFor={(k) => toggleKindHref(params, k)}
          allHref={feedHref(params, { kinds: [] })}
        />
        <FilterControls params={params} sources={sources} />
        <ActiveFilters params={params} sourceName={sourceName} />
      </div>

      {error && <p className="text-sm text-kind-opinion">Could not load the search index: {error}</p>}
      {!error && !result && <p className="text-sm text-faint">Loading…</p>}
      {result && result.items.length === 0 && (
        <EmptyState
          title={filtering ? "No items match" : "Nothing to search yet"}
          hint={filtering ? "Try removing a filter or broadening the search." : undefined}
        />
      )}
      {result && (
        <ul>
          {result.items.map((item) => (
            <ItemRow key={item.id} item={item} />
          ))}
        </ul>
      )}
      {result && (
        <Pagination
          page={result.page}
          totalPages={result.totalPages}
          hrefFor={(p) => feedHref(params, { page: p })}
        />
      )}
    </section>
  );
}
