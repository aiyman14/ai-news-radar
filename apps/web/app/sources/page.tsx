import { getSnapshot } from "../../lib/data";
import { sourcesHealth } from "../../lib/queries";
import { formatEastern } from "../../lib/time";
import { SectionHeader } from "../../components/SectionHeader";
import { EmptyState } from "../../components/EmptyState";

const TH = "px-3 py-2 text-left text-xs font-semibold uppercase tracking-wider text-faint";
const TD = "px-3 py-2 text-sm";

/** Source health for the current radar: items per source, last item, errors. */
export default async function SourcesPage() {
  const snapshot = await getSnapshot();
  const { sources, runs } = sourcesHealth(snapshot);

  return (
    <section>
      <SectionHeader title="Sources" description="What this build ingested, per source" />

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-faint">Latest run</h2>
      {runs.length === 0 && <EmptyState title="No runs yet" />}
      <ul className="mb-6">
        {runs.map((r) => (
          <li key={r.id} className="border-b border-border/60 px-1 py-2 text-sm last:border-b-0">
            <span className="text-faint">{formatEastern(r.started_at)}</span>{" "}
            <span className="text-muted">· {r.trigger} ·</span>{" "}
            <strong
              className={
                r.status === "success"
                  ? "text-kind-tool"
                  : r.status === "failed"
                    ? "text-kind-opinion"
                    : "text-kind-tip"
              }
            >
              {r.status}
            </strong>{" "}
            <span className="text-muted">
              · fetched {r.items_fetched} · kept {r.items_new} · failed {r.items_failed}
              {r.notes ? ` · ${r.notes}` : ""}
            </span>
          </li>
        ))}
      </ul>

      <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-faint">
        Source health ({sources.length})
      </h2>
      {sources.length === 0 && <EmptyState title="No sources configured" />}
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full border-collapse bg-surface">
          <thead className="border-b border-border">
            <tr>
              <th className={TH}>Source</th>
              <th className={TH}>Type</th>
              <th className={TH}>Enabled</th>
              <th className={TH}>Trust</th>
              <th className={TH}>Items</th>
              <th className={TH}>Last item</th>
              <th className={TH}>Errors</th>
            </tr>
          </thead>
          <tbody>
            {sources.map((s) => (
              <tr key={s.id} className="border-b border-border/50 last:border-b-0">
                <td className={`${TD} text-fg`}>
                  {s.url ? (
                    <a href={s.url} className="hover:text-accent" target="_blank" rel="noreferrer">
                      {s.name}
                    </a>
                  ) : (
                    s.name
                  )}
                </td>
                <td className={`${TD} text-muted`}>{s.type}</td>
                <td className={`${TD} ${s.enabled ? "text-kind-tool" : "text-faint"}`}>
                  {s.enabled ? "yes" : "no"}
                </td>
                <td className={`${TD} text-muted`}>{s.trust_score}</td>
                <td className={`${TD} text-muted`}>{s.items_ingested}</td>
                <td className={`${TD} text-faint`}>{formatEastern(s.last_item_at)}</td>
                <td className={`${TD} ${s.recent_error_count > 0 ? "text-kind-opinion" : "text-faint"}`}>
                  {s.recent_error_count}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
