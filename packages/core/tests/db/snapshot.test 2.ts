import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runIngest } from "../../src/pipeline/index";
import { createInMemoryRepositories } from "../../src/db/repositories/memory";
import {
  buildSnapshot,
  emptySnapshot,
  readSnapshotFile,
  writeSnapshotFile,
  BODY_TEXT_MAX_CHARS,
} from "../../src/db/snapshot";
import { getAdapter } from "../../src/adapters/registry";
import { findSource } from "../../src/sources";
import type { Logger } from "../../src/adapters/types";

const silent: Logger = { info: () => {}, warn: () => {}, error: () => {} };
const dirs: string[] = [];
afterEach(async () => {
  for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
});

async function fixtureStores() {
  const fake = findSource("fake-fixture");
  if (!fake) throw new Error("fake-fixture missing");
  const { repos, stores } = createInMemoryRepositories([fake]);
  await runIngest(
    { repos, getAdapter, logger: silent, env: {} },
    { trigger: "manual", sourceSlugs: ["fake-fixture"] },
  );
  return stores;
}

describe("buildSnapshot", () => {
  it("serializes items, sources, the run and no errors after a fake-fixture run", async () => {
    const stores = await fixtureStores();
    const at = new Date("2026-10-20T06:00:00Z");
    const snap = buildSnapshot(stores, at, { windowDays: 0 }); // fixture dates are fixed in July

    expect(snap.generatedAt).toBe(at.toISOString());
    expect(snap.sources.map((s) => s.slug)).toEqual(["fake-fixture"]);
    expect(snap.items).toHaveLength(2);
    expect(snap.runs).toHaveLength(1);
    expect(snap.runs[0]?.status).toBe("success");
    expect(snap.errors).toHaveLength(0);

    const launch = snap.items.find((i) => i.external_id === "fake-001");
    expect(launch?.source_name).toBe("Fake fixture source");
    expect(launch?.kind).toBe("launch");
    expect(launch?.published_at).toBe("2026-07-05T14:30:00.000Z");
    expect(launch?.status).toBe("active");
    expect(launch?.body_html).toBeNull();
    expect(launch?.embedding).toBeNull();
  });

  it("applies the freshness window and reconciles clusters against survivors", async () => {
    const stores = await fixtureStores();
    const [a, b] = stores.normalizedItems;
    if (!a || !b) throw new Error("fixture has 2 items");
    // Fixture items are published 2026-07-05 14:30 and 2026-07-06 09:00.
    // Pretend they share a story, then snapshot on 2026-07-13 00:00 with a
    // 7-day window (cutoff 07-06 00:00): the older item falls out and the
    // cluster drops below 2 members.
    stores.clusters.push({
      id: "c1", representativeId: b.id, title: "t", summary: null, tags: [], entities: [],
      itemCount: 2, firstSeenAt: "", lastSeenAt: "", score: 1, createdAt: "", updatedAt: "",
    });
    a.clusterId = "c1";
    b.clusterId = "c1";

    const everything = buildSnapshot(stores, new Date("2026-07-13T00:00:00Z"), { windowDays: 0 });
    expect(everything.items).toHaveLength(2);
    expect(everything.clusters[0]?.item_count).toBe(2);

    const windowed = buildSnapshot(stores, new Date("2026-07-13T00:00:00Z"), { windowDays: 7 });
    expect(windowed.items.map((i) => i.external_id)).toEqual(["fake-002"]);
    expect(windowed.clusters).toHaveLength(0);
    expect(windowed.items[0]?.cluster_id).toBeNull();
  });

  it("caps body_text and never ships raw html", async () => {
    const stores = await fixtureStores();
    const entry = stores.normalizedItems[0];
    if (!entry) throw new Error("no items");
    entry.draft.bodyText = "x".repeat(BODY_TEXT_MAX_CHARS + 500);
    entry.draft.bodyHtml = "<p>never shipped</p>";
    const row = buildSnapshot(stores, new Date(), { windowDays: 0 }).items.find((i) => i.id === entry.id);
    expect(row?.body_text?.length).toBe(BODY_TEXT_MAX_CHARS + 1); // + ellipsis
    expect(row?.body_text?.endsWith("…")).toBe(true);
    expect(row?.body_html).toBeNull();
  });

  it("round-trips through the snapshot file and reads a missing file as empty", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "radar-snap-"));
    dirs.push(dir);
    const file = path.join(dir, "nested", "radar.json");

    expect(await readSnapshotFile(file)).toEqual(emptySnapshot());

    const snap = buildSnapshot(await fixtureStores(), new Date(), { windowDays: 0 });
    await writeSnapshotFile(file, snap);
    expect(await readSnapshotFile(file)).toEqual(snap);
  });
});
