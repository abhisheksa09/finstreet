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

## Live

- App: **https://finstreet.pages.dev** (Cloudflare Pages)
- API + collector: https://finstreet.nse-scanner.workers.dev (Worker `finstreet`, cron every 15 min)

## Deploy

**Automatic:** every push to `main` runs `.github/workflows/deploy.yml` — tests, then deploys
the Worker and the Pages app. Requires the `CLOUDFLARE_API_TOKEN` repository secret.
You can also run it by hand from GitHub → Actions → Deploy → Run workflow.

**Manual** (same result, from your machine):

```bash
cd worker
npm run deploy        # backend Worker: API + 15-min collector (cron registers only via `wrangler deploy`)
npm run deploy:web    # app (web/) to Cloudflare Pages -> finstreet.pages.dev
```

First-time setup on a new account: `npx wrangler login`, `npx wrangler d1 create market-news`
(paste the id into `wrangler.toml`), `npm run db:init:remote`, then the two deploys above.
`web/config.js` decides which API the app calls (Pages -> Worker URL; local :5173 -> local dev).

Note: the free Workers plan allows 5 cron triggers per account.

## API

| Endpoint | Description |
| --- | --- |
| `GET /api/feed?region=india\|global[&sector=…][&before=…][&limit=…]` | Stories newest first, each with all outlet links |
| `GET /api/feed?companies=INFY,TCS,…` | Stories naming any of these NSE symbols (both regions) — powers My Stocks |
| `GET /api/counts[?sector=…]` | Headline count per region (tab badges) |
| `GET /api/sources` | Enabled sources (About screen) |
| `GET /api/meta` | Sector names, watchlist companies, last collector run |

## Tuning

- **Sources** — `worker/seed.sql`; disable one live with
  `UPDATE sources SET enabled = 0 WHERE id = '…'`
- **Sector keywords** — `worker/src/sectors.json`
- **Companies (My Stocks)** — `worker/src/companies.json`: the Nifty 100 with aliases. After editing it
  (or `sectors.json`), bump `TAGGING_VERSION` in `worker/src/tagging.ts` so stored headlines are re-tagged.
- **Same-story threshold** — `SAME_STORY_THRESHOLD` in `worker/src/dedupe.ts` (default 0.6)

## Before the Play Store

- App icons are ready: `web/icons/icon-192.png`, `icon-512.png`, `icon-maskable-512.png` (rendered from `icon.svg`);
  `web/icons/logo.svg` is the horizontal logo with tagline for the store listing
- Wrap the PWA as a Trusted Web Activity with [Bubblewrap](https://github.com/GoogleChromeLabs/bubblewrap)
- Work through the content-rules checklist in SPEC.md §9
