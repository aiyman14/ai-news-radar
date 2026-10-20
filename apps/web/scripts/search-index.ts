/**
 * Prebuild: write the browser-side search index (public/search-index.json)
 * from the snapshot. The /search page fetches this one static file and
 * filters in the browser — no API, no server.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { getSnapshot, SNAPSHOT_FILE } from "../lib/data";
import { toItemCards } from "../lib/item-card";

async function main() {
  const snapshot = await getSnapshot();
  const cards = toItemCards(snapshot.items, snapshot.clusters);
  const out = path.resolve(process.cwd(), "public/search-index.json");
  await mkdir(path.dirname(out), { recursive: true });
  const body = JSON.stringify({ generatedAt: snapshot.generatedAt, items: cards });
  await writeFile(out, body, "utf8");
  console.log(
    `search index: ${cards.length} items, ${(body.length / 1024).toFixed(0)} KB → ${out}` +
      (snapshot.items.length === 0 ? ` (snapshot ${SNAPSHOT_FILE} has no items; empty index)` : ""),
  );
}

main().catch((e) => {
  console.error("search index failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
