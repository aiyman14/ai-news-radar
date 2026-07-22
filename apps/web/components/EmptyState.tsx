/** Consistent empty state. */
export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-surface/50 px-6 py-10 text-center">
      <p className="text-sm font-medium text-muted">{title}</p>
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}
