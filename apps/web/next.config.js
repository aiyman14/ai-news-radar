/** @type {import('next').NextConfig} */

// Host-agnostic security headers.
// Strict-Transport-Security is deliberately NOT set here: hosting platforms
// (e.g. Vercel) send it, and setting it in-app would poison plain-http
// localhost dev.

// connect-src must allow the Supabase project (REST + realtime websocket).
// Derived from env at build time; the wildcard fallback keeps prod safe even
// if the env var is somehow absent at build.
const supabaseOrigin = (() => {
  try {
    return new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).origin;
  } catch {
    return "https://*.supabase.co";
  }
})();
const supabaseWs = supabaseOrigin.replace(/^http/, "ws");
const isDev = process.env.NODE_ENV !== "production";

// Enforced now: directives that cannot affect page rendering (no script/style/
// img sources involved), so they are zero-breakage on any host incl. localhost.
const cspEnforced = [
  "frame-ancestors 'none'", // header-level twin of X-Frame-Options: DENY
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

// Report-Only: the full policy, observed before enforcement.
// 'unsafe-inline' script/style is the documented Next.js App Router baseline
// without a nonce pipeline; 'unsafe-eval' is dev-only (react-refresh).
// img-src allows any https host: feed thumbnails come from arbitrary sources.
const cspReportOnly = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' https: data:",
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseOrigin} ${supabaseWs}`,
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" }, // no embedding → no clickjacking
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: cspEnforced },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig = {
  transpilePackages: ["@radar/core"],
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

module.exports = nextConfig;
