import type { SourceAdapter } from "./types";
import type { SourceType } from "../types/source";
import { fakeAdapter } from "./fake";
import { rssAdapter } from "./rss";
import { githubReleasesAdapter } from "./github";
import { huggingfaceAdapter } from "./huggingface";
import { createStubAdapter } from "./stub";

/**
 * type -> adapter map. Adding a source type = implement SourceAdapter,
 * register it here. Nothing else in the pipeline changes.
 */
const REGISTRY: Record<SourceType, SourceAdapter> = {
  fake: fakeAdapter,
  rss: rssAdapter,
  github_releases: githubReleasesAdapter,
  huggingface: huggingfaceAdapter,
  hn: createStubAdapter("hn"),
  changelog: createStubAdapter("changelog"),
  placeholder: createStubAdapter("placeholder"),
};

export function getAdapter(type: SourceType): SourceAdapter {
  return REGISTRY[type];
}

export type AdapterResolver = typeof getAdapter;
