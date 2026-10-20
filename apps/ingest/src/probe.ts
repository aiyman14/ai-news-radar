/**
 * Source reachability probe — a diagnostic, not part of the pipeline.
 * Fetches a few URL × User-Agent variants and prints the HTTP status for
 * each, so a GitHub Actions run (.github/workflows/probe.yml) can show
 * which hosts block the runner's IP range and whether a UA change helps.
 * Usage: tsx src/probe.ts
 */
const UAS: Record<string, string> = {
  radar: "ai-news-radar:ingest:v0 (AI news feed reader)",
  browser:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

const TARGETS: Array<[label: string, url: string, ua: keyof typeof UAS]> = [
  ["reddit www rss / radar UA", "https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day&limit=5", "radar"],
  ["reddit www rss / browser UA", "https://www.reddit.com/r/MachineLearning/top/.rss?t=day&limit=5", "browser"],
  ["reddit old rss / radar UA", "https://old.reddit.com/r/OpenAI/top/.rss?t=day&limit=5", "radar"],
  ["reddit old rss / browser UA", "https://old.reddit.com/r/ClaudeAI/top/.rss?t=day&limit=5", "browser"],
  ["reddit www json / browser UA", "https://www.reddit.com/r/StableDiffusion/top.json?t=day&limit=5", "browser"],
  ["venturebeat / radar UA", "https://venturebeat.com/category/ai/feed/", "radar"],
  ["venturebeat / browser UA", "https://venturebeat.com/category/ai/feed/", "browser"],
  ["import ai / radar UA", "https://importai.substack.com/feed", "radar"],
  ["import ai / browser UA", "https://importai.substack.com/feed", "browser"],
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

for (const [label, url, ua] of TARGETS) {
  const started = Date.now();
  try {
    const res = await fetch(url, {
      headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*", "user-agent": UAS[ua] ?? "" },
      redirect: "follow",
      signal: AbortSignal.timeout(15_000),
    });
    const body = await res.text();
    const looksXml = /<(rss|feed)[\s>]/.test(body.slice(0, 2000));
    const looksJson = body.trimStart().startsWith("{");
    console.log(
      `${res.status} ${res.statusText.padEnd(12)} ${String(Date.now() - started).padStart(5)}ms  ${label}` +
        `  → ${looksXml ? "xml ok" : looksJson ? "json ok" : `not feed: ${body.replace(/\s+/g, " ").slice(0, 80)}`}`,
    );
  } catch (e) {
    console.log(`ERR ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (url.includes("reddit")) await sleep(12_000);
}
