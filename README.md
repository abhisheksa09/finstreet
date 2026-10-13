# FinStreet

Indian and global market headlines in one de-duplicated, sector-tagged feed — **links only**,
every article is read on the publisher's own site. See [SPEC.md](SPEC.md) for the full spec.

```
worker/   Cloudflare Worker: collector (cron, every 15 min) + read-only JSON API, D1 storage
web/      PWA, vanilla JS, no build step
```

## Prerequisites

- Node.js 20+
- A Cloudflare account (free plan is enough) for deploying; local dev needs no account

## Run locally

```bash
cd worker
npm install
npm run db:init:local          # create tables + seed the 9 feeds in a local D1
npm run dev                    # API on http://127.0.0.1:8787
```

Trigger a collector run by hand (the dev server is started with `--test-scheduled`):

```bash
curl "http://127.0.0.1:8787/__scheduled?cron=*/15+*+*+*+*"
curl "http://127.0.0.1:8787/api/feed?region=india&limit=5"
```

Serve the web app from a second terminal (any static server works):

```bash
npx serve web -l 5173
```

Open http://localhost:5173. `web/config.js` points the app at the local API.

## Tests

```bash
cd worker
npm test            # tagging, duplicate detection, feed parsing
npm run typecheck
```

## Deploy

1. `cd worker && npx wrangler login`
2. `npx wrangler d1 create market-news` → paste the `database_id` into `wrangler.toml`
3. Set `CONTACT_EMAIL` and `ALLOWED_ORIGIN` (the PWA's URL) in `wrangler.toml`
4. `npm run db:init:remote`
5. `npm run deploy` — **use `wrangler deploy`**; cron triggers are not registered by `wrangler versions upload`
6. Set `apiBase` in `web/config.js` to the Worker URL, then deploy `web/` to Cloudflare Pages or GitHub Pages

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/feed?region=india\|global[&sector=…][&before=…][&limit=…]` | Stories newest first, each with all outlet links |
| `GET /api/sources` | Enabled sources (About screen) |
| `GET /api/meta` | Sector names, watchlist companies, last collector run |

## Tuning

- **Sources** — `worker/seed.sql`; disable one live with
  `UPDATE sources SET enabled = 0 WHERE id = '…'`
- **Sector keywords** — `worker/src/sectors.json`
- **Watchlist companies** — `worker/src/companies.json` (starter list; extend to Nifty 100).
  Prefer multi-word aliases: short ones like "ITC" or "Titan" match unrelated headlines.
- **Same-story threshold** — `SAME_STORY_THRESHOLD` in `worker/src/dedupe.ts` (default 0.6)

## Before the Play Store

- Replace `web/icons/icon.svg` with PNG icons (192×192 and 512×512, plus a maskable version)
- Wrap the PWA as a Trusted Web Activity with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
- Work through the content-rules checklist in SPEC.md §9
