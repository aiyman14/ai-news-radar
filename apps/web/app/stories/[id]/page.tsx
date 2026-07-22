import Link from "next/link";
import { createServerSupabase } from "../../../lib/supabase-server";
import { fetchStory } from "../../../lib/queries";
import { formatEastern } from "../../../lib/time";
import { ItemRow } from "../../../components/ItemRow";
import { EmptyState } from "../../../components/EmptyState";
import { CHIP_NEUTRAL } from "../../../lib/ui";

export const dynamic = "force-dynamic";

/** Cluster detail — the story plus its member items. */
export default async function StoryPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createServerSupabase();
  const { cluster, items, error } = await fetchStory(supabase, id);

  if (error) return <p className="text-sm text-kind-opinion">Error: {error}</p>;
  if (!cluster) return <EmptyState title="Story not found" />;

  return (
    <section>
      <div className="mb-5 rounded-lg border border-border bg-surface p-4">
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          {cluster.title ?? "Untitled story"}
        </h1>
        {cluster.summary && <p className="mt-1 text-sm text-muted">{cluster.summary}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-faint">
          <span className={CHIP_NEUTRAL}>📚 {cluster.item_count} sources</span>
          <span className={CHIP_NEUTRAL}>score {cluster.score}</span>
          <span>first seen {formatEastern(cluster.first_seen_at)}</span>
          <span>·</span>
          <span>last seen {formatEastern(cluster.last_seen_at)}</span>
        </div>
        {(cluster.tags.length > 0 || cluster.entities.length > 0) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {cluster.tags.map((tag) => (
              <Link
                key={tag}
                href={`/?tag=${encodeURIComponent(tag)}`}
                className="text-faint hover:text-accent"
              >
                #{tag}
              </Link>
            ))}
            {cluster.entities.map((entity) => (
              <Link
                key={entity}
                href={`/?entity=${encodeURIComponent(entity)}`}
                className="text-faint hover:text-accent"
              >
                @{entity}
              </Link>
            ))}
          </div>
        )}
      </div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-faint">
        Coverage
      </h2>
      {items.length === 0 && <EmptyState title="No visible items in this story" />}
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} showClusterChip={false} />
        ))}
      </ul>
    </section>
  );
}
