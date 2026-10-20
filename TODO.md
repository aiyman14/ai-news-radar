# TODO — roadmap

Self-orienting list for any session opened in this repo.

## 1. Go live (one-time, ~5 minutes)

- [ ] Make the repository **public** (Settings → General → Danger Zone).
      GitHub Pages and unlimited Actions minutes both need it.
- [ ] Run the `radar` workflow once by hand (Actions → radar → Run workflow).
      It fetches all sources (~9 min), builds the site, and pushes the
      `gh-pages` branch.
- [ ] Settings → Pages → Source: *Deploy from a branch* → `gh-pages` / `/ (root)`
      (GitHub usually enables this automatically when the branch appears —
      check that the URL shows up).
- [ ] Open https://aiyman14.github.io/ai-news-radar/ — feed, /search, /trending,
      a story page.
- [ ] Repo settings: add the live URL as the website, a short description,
      topics (`ai`, `news`, `rss`, `nextjs`, `typescript`, `github-actions`).
- [ ] Pin it on your profile.

**Known failure mode, and why it's covered:** GitHub disables scheduled
workflows on public repos after 60 days without repository activity. The
daily `gh-pages` push counts as activity. If GitHub ever emails that the
schedule was disabled anyway, re-enable it with one click in the Actions tab.

## 2. Visual design pass

The UI is a functional token-based dark shell. All colors/spacing flow from
CSS variables in `apps/web/app/globals.css` (mapped in `tailwind.config.ts`);
components reference tokens only, so a restyle is mostly a token edit plus
targeted component polish (typography scale, card density, mobile nav).

## 3. More sources

- [ ] arXiv (cs.AI / cs.LG / cs.CL) — RSS adapter, kind `research`.
- [ ] Hacker News — the `hn` adapter stub exists; front page + "Show HN"
      filtered by AI keywords.
- [ ] Source audit: prune noisy feeds, tune per-source `trust_score`.

## 4. Optional intelligence (costs money; off by default)

- [ ] Add `LLM_PROVIDER` + key as repo secrets → per-item summaries land in
      the snapshot; surface `llm_summary` in the UI.
- [ ] Embeddings + `CLUSTER_SEMANTIC=1` after calibrating against real pairs.
