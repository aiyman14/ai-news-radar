import path from "node:path";
import { readSnapshotFile, type Snapshot } from "@radar/core";

/**
 * Build-time data access. The app is a static export: every page reads the
 * snapshot the ingest run wrote (`<repo>/data/radar.json`) while
 * `next build` runs, and the result is plain HTML. There is no runtime data
 * source and nothing is fetched in the browser except the search index.
 */
export const SNAPSHOT_FILE = process.env.RADAR_SNAPSHOT
  ? path.resolve(process.env.RADAR_SNAPSHOT)
  : path.resolve(process.cwd(), "../../data/radar.json");

let pending: Promise<Snapshot> | null = null;

export function getSnapshot(): Promise<Snapshot> {
  pending ??= readSnapshotFile(SNAPSHOT_FILE);
  return pending;
}
