"use client";

import { useRouter } from "next/navigation";
import { feedHref, RANGE_LABEL, RANGES, type FeedParams } from "../lib/feed-params";
import { INPUT } from "../lib/ui";

const CHECKBOX_LABEL = "flex cursor-pointer items-center gap-1.5 text-xs text-muted hover:text-fg";

/**
 * Feed filter controls: source dropdown, date range,
 * has-image + clustered-only toggles. Every change is a router.push to a
 * URL built by feedHref — state lives in the URL, never in the component.
 */
export function FilterControls({
  params,
  sources,
}: {
  params: FeedParams;
  sources: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const go = (overrides: Partial<FeedParams>) => router.push(feedHref(params, overrides));

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <select
        aria-label="Filter by source"
        className={`${INPUT} py-1 text-xs`}
        value={params.source}
        onChange={(e) => go({ source: e.target.value })}
      >
        <option value="">All sources</option>
        {sources.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name}
          </option>
        ))}
      </select>
      <select
        aria-label="Filter by date range"
        className={`${INPUT} py-1 text-xs`}
        value={params.range}
        onChange={(e) => go({ range: e.target.value })}
      >
        <option value="">All time</option>
        {RANGES.map((r) => (
          <option key={r} value={r}>
            {RANGE_LABEL[r]}
          </option>
        ))}
      </select>
      <label className={CHECKBOX_LABEL}>
        <input
          type="checkbox"
          className="accent-[rgb(var(--accent))]"
          checked={params.img}
          onChange={(e) => go({ img: e.target.checked })}
        />
        Has image
      </label>
      <label className={CHECKBOX_LABEL}>
        <input
          type="checkbox"
          className="accent-[rgb(var(--accent))]"
          checked={params.clustered}
          onChange={(e) => go({ clustered: e.target.checked })}
        />
        In a story
      </label>
    </div>
  );
}
