import Link from "next/link";
import { getSnapshot } from "../../lib/data";
import { cardsOfKinds } from "../../lib/queries";
import { SEARCH_PATH } from "../../lib/feed-params";
import { ItemRow } from "../../components/ItemRow";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState } from "../../components/EmptyState";
import { SearchBox } from "../../components/SearchBox";

const LIMIT = 100;

/** Tips & tricks — kind = tip; search goes to /search. */
export default async function TipsPage() {
  const snapshot = await getSnapshot();
  const all = cardsOfKinds(snapshot, ["tip"]);
  const items = all.slice(0, LIMIT);

  return (
    <section>
      <SectionHeader title="Tips & tricks" description="Kind: tip" count={all.length}>
        <SearchBox
          action={SEARCH_PATH}
          q=""
          placeholder="Search tips…"
          clearHref={SEARCH_PATH}
          hidden={{ kind: "tip" }}
        />
      </SectionHeader>
      {items.length === 0 && <EmptyState title="No tips yet" />}
      <ul>
        {items.map((item) => (
          <ItemRow key={item.id} item={item} />
        ))}
      </ul>
      {all.length > LIMIT && (
        <p className="mt-4 text-sm text-muted">
          Showing the latest {LIMIT}.{" "}
          <Link className="hover:text-accent" href={`${SEARCH_PATH}?kind=tip`}>
            Browse all {all.length} →
          </Link>
        </p>
      )}
    </section>
  );
}
