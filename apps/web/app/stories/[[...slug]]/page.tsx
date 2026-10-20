import Link from "next/link";
import { notFound } from "next/navigation";
import { getSnapshot } from "../../../lib/data";
import { story, topStories } from "../../../lib/queries";
import { formatEastern } from "../../../lib/time";
import { ItemRow } from "../../../components/ItemRow";
import { EmptyState } from "../../../components/EmptyState";
import { SectionHeader } from "../../../components/SectionHeader";
import { CHIP_NEUTRAL } from "../../../lib/ui";

/**
 * STORIES — "/stories" (every cluster in this radar, best first) and
 * "/stories/<id>" (one cluster + its coverage). One optional catch-all so
 * the static export always has ≥1 param even when a snapshot has no
 * clusters (e.g. the CI smoke build).
 */
export const dynamicParams = false;

export async function generateStaticParams() {
  const snapshot = await getSnapshot();
  return [{ slug: [] }, ...snapshot.clusters.map((c) => ({ slug: [c.id] }))];
}

async function StoriesIndex() {
  const snapshot = await getSnapshot();
  const { stories } = topStories(snapshot, { hours: 24 * 365, minCount: 0, limit: 500 });
  return (
    <section>
      <SectionHeader
        title="Stories"
        description="Related coverage grouped by title similarity · best first"
        count={stories.length}
      />
      {stories.length === 0 && <EmptyState title="No stories in this radar yet" />}
      <ul>
        {stories.map((s) => (
          <li key={s.id} className="border-b border-border/60 px-1 py-2.5 last:border-b-0">
            <Link href={`/stories/${s.id}`} className="text-[15px] font-medium text-fg hover:text-accent">
              {s.title ?? "Untitled story"}
            </Link>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-faint">
              <span className={CHIP_NEUTRAL}>📚 {s.item_count} sources</span>
              <span>score {s.score}</span>
              {s.representative && <span>{s.representative.source_name}</span>}
              <span>last seen {formatEastern(s.last_seen_at)}</span>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default async function StoryPage({ params }: { params: Promise<{ slug?: string[] }> }) {
  const slug = (await params).slug ?? [];
  if (slug.length === 0) return <StoriesIndex />;
  if (slug.length !== 1) notFound();

  const snapshot = await getSnapshot();
  const { cluster, items } = story(snapshot, slug[0] ?? "");
  if (!cluster) notFound();

  return (
    <section>
      <p className="mb-3 text-xs text-faint">
        <Link href="/stories" className="hover:text-fg">
          ← All stories
        </Link>
      </p>
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
              <Link key={tag} href={`/search?tag=${encodeURIComponent(tag)}`} className="text-faint hover:text-accent">
                #{tag}
              </Link>
            ))}
            {cluster.entities.map((entity) => (
              <Link key={entity} href={`/search?entity=${encodeURIComponent(entity)}`} className="text-faint hover:text-accent">
                @{entity}
              </Link>
            ))}
          </div>
        )}
      </div>
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-faint">Coverage</h2>
      {items.length === 0 && <EmptyState title="No visible items in this story" />}
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} showClusterChip={false} />
        ))}
      </ul>
    </section>
  );
}
