/** Site-wide constants. */
export const REPO_URL = "https://github.com/aiyman14/ai-news-radar";
export const SITE_NAME = "AI News Radar";
/** Set at build time for GitHub Pages project sites (e.g. "/ai-news-radar"). */
export const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
/** Where the client-side search loads its index from (a static file). */
export const SEARCH_INDEX_URL = `${BASE_PATH}/search-index.json`;
