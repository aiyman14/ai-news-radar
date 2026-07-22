import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { createServerSupabase } from "../lib/supabase-server";
import { fetchLatestRun } from "../lib/queries";
import { NavLink } from "../components/NavLinks";
import { RefreshTimer } from "../components/RefreshTimer";

export const metadata: Metadata = {
  title: "AI News Radar",
  description: "Open-source AI news dashboard: 32 sources, clustered into stories",
};

const NAV = [
  ["/", "Feed"],
  ["/trending", "Trending"],
  ["/tools", "Tools"],
  ["/tips", "Tips"],
  ["/sources", "Sources"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Latest run for the header timer — anon read, public data.
  const supabase = createServerSupabase();
  const { run } = await fetchLatestRun(supabase);

  return (
    <html lang="en">
      <body className="min-h-screen">
        <header className="sticky top-0 z-20 border-b border-border bg-bg/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-5 gap-y-1 px-4 py-2.5">
            <Link href="/" className="select-none">
              <span className="rounded-md bg-accent/15 px-2 py-0.5 text-sm font-bold tracking-wide text-accent">
                Radar
              </span>
            </Link>
            <nav className="flex flex-wrap items-center gap-0.5">
              {NAV.map(([href, label]) => (
                <NavLink key={href} href={href} label={label} />
              ))}
            </nav>
            <div className="ml-auto">
              <RefreshTimer
                lastRun={
                  run
                    ? {
                        started_at: run.started_at,
                        finished_at: run.finished_at,
                        status: run.status,
                        items_new: run.items_new,
                      }
                    : null
                }
              />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl px-4 py-5">{children}</main>
      </body>
    </html>
  );
}
