import Link from "next/link";
import type { TopStory } from "../lib/queries";
import { CHIP_NEUTRAL } from "../lib/ui";

/**
 * Techmeme-style top-stories strip: up to 6 highest-score clusters from the
 * window as compact cards above the river.
 */
export function TopStoriesStrip({
  stories,
  windowHours,
}: {
  stories: TopStory[];
  windowHours: number;
}) {
  if (stories.length === 0) return null;

  return (
    <section aria-label="Top stories" className="mb-6">
      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-faint">
        Top stories <span className="font-normal normal-case">· last {windowHours}h</span>
      </h2>
      <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
        {stories.map((story) => (
          <Link
            key={story.id}
            href={`/stories/${story.id}`}
            className="group flex gap-3 rounded-lg border border-border bg-surface p-3 hover:border-accent/40"
          >
            {story.representative?.image_url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={story.representative.image_url}
                alt=""
                loading="lazy"
                className="h-14 w-14 shrink-0 rounded-md border border-border/60 object-cover"
              />
            )}
            <div className="min-w-0">
              <h3 className="line-clamp-2 text-sm font-medium leading-snug text-fg group-hover:text-accent">
                {story.title ?? "Untitled story"}
              </h3>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-faint">
                <span className={CHIP_NEUTRAL}>
                  📚 {story.item_count} source{story.item_count === 1 ? "" : "s"}
                </span>
                <span>score {story.score}</span>
                {story.representative && <span>{story.representative.source_name}</span>}
              </div>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
