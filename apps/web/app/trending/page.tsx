import Link from "next/link";
import { getSnapshot } from "../../lib/data";
import { trending, type TrendingCount } from "../../lib/queries";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState } from "../../components/EmptyState";

/** ▲/▼ vs the previous equal window. */
function Delta({ delta }: { delta: number }) {
  if (delta > 0) return <span className="text-kind-tool">▲ {delta}</span>;
  if (delta < 0) return <span className="text-kind-opinion">▼ {Math.abs(delta)}</span>;
  return <span className="text-faint">—</span>;
}

function TrendList({
  entries,
  hrefFor,
}: {
  entries: TrendingCount[];
  hrefFor: (name: string) => string;
}) {
  if (entries.length === 0) return <p className="text-xs text-faint">No data.</p>;
  return (
    <ul className="space-y-1">
      {entries.map(({ name, count, delta }) => (
        <li key={name} className="flex items-center justify-between gap-2 text-sm">
          <Link
            href={hrefFor(name)}
            className="min-w-0 truncate text-fg hover:text-accent"
            title="Show matching items"
          >
            {name}
          </Link>
          <span className="flex shrink-0 items-center gap-2 text-xs">
            <span className="text-muted">{count}</span>
            <Delta delta={delta} />
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Trending topics & entities over 24/48/72h, each with a delta vs the
 * previous equal window. Names click through to the filtered search.
 */
export default async function TrendingPage() {
  const snapshot = await getSnapshot();
  const windows = trending(snapshot);
  const empty = windows.every((w) => w.tags.length === 0 && w.entities.length === 0);

  return (
    <section>
      <SectionHeader
        title="Trending"
        description="Top topics and entities per window · ▲▼ vs the previous equal window"
      />
      {empty && <EmptyState title="No trending data yet" />}
      {!empty && (
        <div className="grid gap-4 md:grid-cols-3">
          {windows.map(({ hours, tags, entities }) => (
            <div key={hours} className="rounded-lg border border-border bg-surface p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-faint">
                Last {hours}h
              </h2>
              <h3 className="mb-1 text-xs font-medium text-muted">Topics</h3>
              <div className="mb-3">
                <TrendList entries={tags} hrefFor={(name) => `/search?tag=${encodeURIComponent(name)}`} />
              </div>
              <h3 className="mb-1 text-xs font-medium text-muted">Entities</h3>
              <TrendList entries={entities} hrefFor={(name) => `/search?entity=${encodeURIComponent(name)}`} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
