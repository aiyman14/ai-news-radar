import Link from "next/link";
import { KINDS, kindChipClass, kindLabel } from "../lib/kinds";
import { CHIP } from "../lib/ui";

export const INACTIVE_CHIP = `${CHIP} border-border bg-transparent text-muted hover:border-accent/40 hover:text-fg`;
export const ALL_ACTIVE_CHIP = `${CHIP} border-accent/40 bg-accent/15 text-accent`;

/**
 * Kind tabs — All + the 7 kinds. `hrefFor` decides where a tab goes: the
 * static feed uses /kind/<kind> pages, the search page toggles its own
 * multi-select query param.
 */
export function KindTabs({
  active,
  hrefFor,
  allHref,
}: {
  /** Active kinds (empty = All). */
  active: readonly string[];
  hrefFor: (kind: string) => string;
  allHref: string;
}) {
  const allActive = active.length === 0;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <Link href={allHref} className={allActive ? ALL_ACTIVE_CHIP : INACTIVE_CHIP}>
        All
      </Link>
      {KINDS.map((kind) => (
        <Link
          key={kind}
          href={hrefFor(kind)}
          className={active.includes(kind) ? `${CHIP} ${kindChipClass(kind)}` : INACTIVE_CHIP}
        >
          {kindLabel(kind)}
        </Link>
      ))}
    </div>
  );
}
