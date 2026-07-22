import Form from "next/form";
import Link from "next/link";
import { INPUT } from "../lib/ui";

/**
 * Section search box. GET form → URL-driven `?q=` state;
 * Enter submits (next/form does client-side navigation), ✕ clears. Other
 * active params survive the submit via hidden inputs.
 */
export function SearchBox({
  action,
  q,
  placeholder = "Search…",
  clearHref,
  hidden = {},
}: {
  /** Path the form navigates to (e.g. "/", "/tools"). */
  action: string;
  q: string;
  placeholder?: string;
  /** Where ✕ goes — same view without `q`. */
  clearHref: string;
  /** Params to preserve across a search submit. */
  hidden?: Record<string, string>;
}) {
  return (
    <Form action={action} className="relative flex items-center">
      {Object.entries(hidden)
        .filter(([, value]) => value !== "")
        .map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
      <input
        type="search"
        name="q"
        defaultValue={q}
        placeholder={placeholder}
        aria-label="Search"
        className={`${INPUT} w-56 pr-7`}
      />
      {q && (
        <Link
          href={clearHref}
          aria-label="Clear search"
          className="absolute right-2 text-sm text-faint hover:text-fg"
        >
          ✕
        </Link>
      )}
    </Form>
  );
}
