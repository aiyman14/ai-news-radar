"use client";

import { useEffect, useState } from "react";

/**
 * Header refresh countdown. Ingestion runs at 00:00 and
 * 12:00 UTC (GH Actions cron) — count down to the next one, ticking.
 * Last-run info is server-fetched (layout) and passed in.
 */
export interface LastRunInfo {
  started_at: string;
  finished_at: string | null;
  status: string;
  items_new: number;
}

/** Next of 00:00 / 12:00 UTC after `now`. */
function nextRefreshUtc(now: Date): Date {
  const next = new Date(now);
  next.setUTCMinutes(0, 0, 0);
  next.setUTCHours(now.getUTCHours() < 12 ? 12 : 24);
  return next;
}

function formatRemaining(ms: number): string {
  const totalMinutes = Math.max(0, Math.ceil(ms / 60_000));
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatRelative(iso: string, now: Date): string {
  const ms = now.getTime() - new Date(iso).getTime();
  const minutes = Math.max(0, Math.floor(ms / 60_000));
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function RefreshTimer({ lastRun }: { lastRun: LastRunInfo | null }) {
  // Clock starts on mount (SSR renders a placeholder → no hydration mismatch).
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const timer = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const remaining = now ? formatRemaining(nextRefreshUtc(now).getTime() - now.getTime()) : "…";
  const runOk = lastRun ? lastRun.status === "success" : false;

  return (
    <div className="text-right text-[11px] leading-tight text-faint">
      <div className="text-muted">Next refresh in {remaining}</div>
      {lastRun && (
        <div>
          Last: {now ? formatRelative(lastRun.finished_at ?? lastRun.started_at, now) : "…"} ·{" "}
          {lastRun.items_new} new{" "}
          <span
            className={runOk ? "text-kind-tool" : "text-kind-tip"}
            title={`Last run status: ${lastRun.status}`}
          >
            {runOk ? "✓" : "⚠"}
          </span>
        </div>
      )}
    </div>
  );
}
