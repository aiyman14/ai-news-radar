import type { ReactNode } from "react";

/**
 * Consistent page header: title + optional description and
 * count on the left, an action slot (search box, controls) on the right.
 */
export function SectionHeader({
  title,
  description,
  count,
  children,
}: {
  title: string;
  description?: string;
  /** Result/row count — rendered as "N results" next to the title. */
  count?: number | null;
  children?: ReactNode;
}) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-6 gap-y-3 border-b border-border pb-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-fg">
          {title}
          {typeof count === "number" && (
            <span className="ml-2 align-middle text-sm font-normal text-faint">
              {count} result{count === 1 ? "" : "s"}
            </span>
          )}
        </h1>
        {description && <p className="mt-0.5 text-sm text-muted">{description}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}
