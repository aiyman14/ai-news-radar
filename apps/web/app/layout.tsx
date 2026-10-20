import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";
import { getSnapshot } from "../lib/data";
import { latestRun } from "../lib/queries";
import { REPO_URL, SITE_NAME } from "../lib/site";
import { NavLink } from "../components/NavLinks";
import { RefreshTimer } from "../components/RefreshTimer";

export const metadata: Metadata = {
  title: SITE_NAME,
  description:
    "A daily radar of AI news: 40 free sources, classified into 7 kinds and clustered into stories. Static, open source, rebuilt every day.",
};

const NAV = [
  ["/", "Feed"],
  ["/search", "Search"],
  ["/stories", "Stories"],
  ["/trending", "Trending"],
  ["/tools", "Tools"],
  ["/tips", "Tips"],
  ["/sources", "Sources"],
] as const;

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const snapshot = await getSnapshot();
  const run = latestRun(snapshot);

  return (
    <html lang="en">
      <body className="flex min-h-screen flex-col">
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
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-5">{children}</main>
        <footer className="border-t border-border">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-xs text-faint">
            <span>{SITE_NAME}</span>
            <span>·</span>
            <a href={REPO_URL} className="hover:text-fg" target="_blank" rel="noreferrer">
              Open source on GitHub
            </a>
            <span>·</span>
            <span>Rebuilt daily by GitHub Actions · static site, no tracking</span>
          </div>
        </footer>
      </body>
    </html>
  );
}
