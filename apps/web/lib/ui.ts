/**
 * Shared class strings. One place for the recurring shapes —
 * chips, buttons, inputs — so pages stay consistent and the design pass has
 * few call sites to restyle. All colors are token-mapped Tailwind classes.
 */

/** Small rounded chip/badge base — pair with a kind/category color class. */
export const CHIP =
  "inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-px text-[11px] font-medium leading-4";

/** Neutral chip (filters, counts, meta). */
export const CHIP_NEUTRAL = `${CHIP} border-border bg-surface-2 text-muted`;

/** Text input / select. */
export const INPUT =
  "rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-sm text-fg placeholder:text-faint focus:border-accent/60 focus:outline-none";

/** Primary button. */
export const BTN =
  "rounded-md border border-accent/40 bg-accent/15 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/25 disabled:opacity-50";

/** Quiet/ghost button (row actions, secondary). */
export const BTN_GHOST =
  "rounded-md border border-border bg-transparent px-2 py-0.5 text-xs text-muted hover:border-accent/40 hover:text-fg disabled:opacity-50";
