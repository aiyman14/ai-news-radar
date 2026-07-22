import type { Config } from "tailwindcss";

/**
 * Tailwind maps to the CSS-variable design tokens defined in app/globals.css
 *. Components use these semantic names only — restyling happens by
 * editing the token values, not the components.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-2": "rgb(var(--surface-2) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        faint: "rgb(var(--faint) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        kind: {
          news: "rgb(var(--kind-news) / <alpha-value>)",
          launch: "rgb(var(--kind-launch) / <alpha-value>)",
          tool: "rgb(var(--kind-tool) / <alpha-value>)",
          tip: "rgb(var(--kind-tip) / <alpha-value>)",
          discussion: "rgb(var(--kind-discussion) / <alpha-value>)",
          research: "rgb(var(--kind-research) / <alpha-value>)",
          opinion: "rgb(var(--kind-opinion) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};

export default config;
