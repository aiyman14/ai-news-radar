import Link from "next/link";
import type { ItemCard } from "../lib/item-card";
import { formatEastern } from "../lib/time";
import { kindChipClass, kindLabel } from "../lib/kinds";
import { CHIP, CHIP_NEUTRAL } from "../lib/ui";

const MAX_TAGS = 4;
const MAX_ENTITIES = 3;

function asCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : null;
}

/** ▲score ★stars ♥likes — engagement keys vary by source; take best match. */
function engagementBits(engagement: ItemCard["engagement"]): string[] {
  if (!engagement) return [];
  const bits: string[] = [];
  const score = asCount(engagement.score) ?? asCount(engagement.trendingScore);
  const stars = asCount(engagement.stars);
  const likes = asCount(engagement.likes) ?? asCount(engagement.reactions);
  if (score !== null) bits.push(`▲ ${score}`);
  if (stars !== null) bits.push(`★ ${stars}`);
  if (likes !== null) bits.push(`♥ ${likes}`);
  return bits;
}

/**
 * THE item card — the one row component used by Feed, Tools, Tips, story
 * members, and search results. Kind chip → kind feed; tags/entities →
 * filtered search; 📚 chip → story page. Pure (no hooks), so it renders
 * both at build time and inside the client-side search page.
 */
export function ItemRow({
  item,
  showClusterChip = true,
}: {
  item: ItemCard;
  showClusterChip?: boolean;
}) {
  const engagement = engagementBits(item.engagement);

  return (
    <li className="flex gap-3 border-b border-border/60 px-1 py-2.5 last:border-b-0">
      {item.image_url && (
        // Arbitrary external hosts → plain <img>, not next/image.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={item.image_url}
          alt=""
          loading="lazy"
          className="mt-0.5 h-14 w-20 shrink-0 rounded-md border border-border/60 object-cover"
        />
      )}
      <div className="min-w-0 flex-1">
        <h3 className="min-w-0 text-[15px] font-medium leading-snug">
          {item.canonical_url ? (
            <a
              href={item.canonical_url}
              target="_blank"
              rel="noreferrer"
              className="item-title text-fg hover:text-accent"
            >
              {item.title}
            </a>
          ) : (
            item.title
          )}
        </h3>
        <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
          <Link
            href={`/kind/${item.kind}`}
            className={`${CHIP} ${kindChipClass(item.kind)}`}
            title={`Show ${kindLabel(item.kind)} only`}
          >
            {kindLabel(item.kind)}
          </Link>
          <span className="text-fg/80">{item.source_name}</span>
          <span className="text-faint">{formatEastern(item.published_at)}</span>
          {engagement.length > 0 && (
            <span className="text-faint">{engagement.join(" · ")}</span>
          )}
          {showClusterChip && item.cluster_id && (
            <Link
              href={`/stories/${item.cluster_id}`}
              className={`${CHIP_NEUTRAL} hover:border-accent/40 hover:text-fg`}
              title="Open story"
            >
              📚 {item.cluster_size ?? "?"} source{item.cluster_size === 1 ? "" : "s"}
            </Link>
          )}
          {item.tags.slice(0, MAX_TAGS).map((tag) => (
            <Link
              key={tag}
              href={`/search?tag=${encodeURIComponent(tag)}`}
              className="text-faint hover:text-accent"
              title={`Search tag "${tag}"`}
            >
              #{tag}
            </Link>
          ))}
          {item.entities.slice(0, MAX_ENTITIES).map((entity) => (
            <Link
              key={entity}
              href={`/search?entity=${encodeURIComponent(entity)}`}
              className="text-faint hover:text-accent"
              title={`Search entity "${entity}"`}
            >
              @{entity}
            </Link>
          ))}
        </div>
      </div>
    </li>
  );
}
