import Link from "next/link";
import { getSnapshot } from "../../lib/data";
import { cardsOfKinds } from "../../lib/queries";
import { SEARCH_PATH } from "../../lib/feed-params";
import { ItemRow } from "../../components/ItemRow";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState } from "../../components/EmptyState";
import { SearchBox } from "../../components/SearchBox";

const KINDS = ["tool", "launch"] as const;
const LIMIT = 100;

/** New tools & launches — kind IN (tool, launch); search goes to /search. */
export default async function ToolsPage() {
  const snapshot = await getSnapshot();
  const all = cardsOfKinds(snapshot, KINDS);
  const items = all.slice(0, LIMIT);

  return (
    <section>
      <SectionHeader title="Tools & launches" description="Kind: tool · launch" count={all.length}>
        <SearchBox
          action={SEARCH_PATH}
          q=""
          placeholder="Search tools…"
          clearHref={SEARCH_PATH}
          hidden={{ kind: KINDS.join(",") }}
        />
      </SectionHeader>
      {items.length === 0 && <EmptyState title="No tools or launches yet" />}
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      {all.length > LIMIT && (
        <p className="mt-4 text-sm text-muted">
          Showing the latest {LIMIT}.{" "}
          <Link className="hover:text-accent" href={`${SEARCH_PATH}?kind=${KINDS.join(",")}`}>
            Browse all {all.length} →
          </Link>
        </p>
      )}
    </section>
  );
}
