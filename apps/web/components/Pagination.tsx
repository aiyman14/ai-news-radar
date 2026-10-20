import Link from "next/link";

export function Pagination({
  page,
  totalPages,
  hrefFor,
}: {
  page: number;
  totalPages: number;
  hrefFor: (page: number) => string;
}) {
  if (totalPages <= 1) return null;
  return (
    <p className="mt-4 flex items-center gap-4 text-sm text-muted">
      {page > 1 && (
        <Link className="hover:text-accent" href={hrefFor(page - 1)}>
          ← Newer
        </Link>
      )}
      <span className="text-faint">
        page {page} of {totalPages}
      </span>
      {page < totalPages && (
        <Link className="hover:text-accent" href={hrefFor(page + 1)}>
          Older →
        </Link>
      )}
    </p>
  );
}
