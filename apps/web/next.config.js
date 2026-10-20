/** @type {import('next').NextConfig} */

// Static export: `next build` emits plain HTML into out/, built from the
// ingest snapshot. GitHub Pages serves it; no server runs anywhere.
// NEXT_PUBLIC_BASE_PATH is "/<repo>" on a GitHub Pages project site and
// empty for a custom domain or local dev.
const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "";

const nextConfig = {
  output: "export",
  trailingSlash: true,
  basePath,
  images: { unoptimized: true },
  transpilePackages: ["@radar/core"],
};

module.exports = nextConfig;
