"use client";

import { useEffect, useState } from "react";

/**
 * Header refresh countdown. The radar is rebuilt once a day by the
 * GitHub Actions cron (REFRESH_HOUR_UTC) — count down to the next one.
 * Last-run info comes from the snapshot at build time.
 */
export const REFRESH_HOUR_UTC = 6;

export interface LastRunInfo {
  started_at: string;
  finished_at: string | null;
  status: string;
  items_new: number;
}

/** Next REFRESH_HOUR_UTC after `now`. */
function nextRefreshUtc(now: Date): Date {
  const next = new Date(now);
  next.setUTCHours(REFRESH_HOUR_UTC, 0, 0, 0);
  if (next.getTime() <= now.getTime()) next.setUTCDate(next.getUTCDate() + 1);
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
  // Clock starts on mount (the static HTML carries a placeholder → no hydration mismatch).
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
          Updated {now ? formatRelative(lastRun.finished_at ?? lastRun.started_at, now) : "…"} ·{" "}
          {lastRun.items_new} items{" "}
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
