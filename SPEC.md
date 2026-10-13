# FinStreet — Spec

> Status: v1 spec · 2026-10-13
> Source plan: "Market News Aggregator — Project Plan" (Claude Docs)
> Origin: grew out of the news digest in the `stock-analyser` repo (`news_digest.py`)

A free app that collects Indian and global market headlines into one de-duplicated,
sector-tagged feed and **links out** to the original publishers. It ships first as an
installable web app (PWA), then to Google Play as a Trusted Web Activity once real use
proves the idea.

---

## 1. Scope

The app shows **headlines and links only**; every article is read on the publisher's own site.

**In scope (v1)**
- Headline, publisher name, publish time and link for each story
- India and Global markets news from public RSS feeds, refreshed every 15 minutes
- Duplicate removal: one story appears once even when several outlets carry it ("+N sources")
- Sector tags and a personal watchlist filter, worked out from the headline text

**Out of scope**
- Article summaries, excerpts or full text (RSS `description` is never stored)
- Publisher logos (publisher names as plain text only)
- Showing articles inside the app — links open in the phone's browser / Chrome Custom Tab
- Buy / sell / hold recommendations of any kind (SEBI regulates investment advice in India)
- User accounts (v1 stores nothing about users on the server)

---

## 2. Target user and positioning

Indian retail investors and traders who check market news before the 09:15 IST open.

| Alternative | What it lacks that this app adds |
| --- | --- |
| Google News | Finance is one topic among many; no sector or stock filtering |
| Pulse by Zerodha | Closest competitor; no sector tags, no watchlist filter, no India/Global split |
| Single-publisher apps (ET Markets, Moneycontrol) | One outlet's view only |

Differentiators to prove in testing:
1. **One feed, no repeats** — India + Global from 6+ outlets, de-duplicated
2. **Sector filters** — Banking, Energy, IT… in one tap
3. **My stocks** — watchlist filters the feed to headlines naming those companies

---

## 3. Features

| Feature | Release | Notes |
| --- | --- | --- |
| India / Global feed tabs | v1 | Newest first, date headings, Jump to date; 90 days kept |
| Duplicate removal | v1 | Same link or near-identical title shown once, with "+N sources" |
| Sector filter chips | v1 | 15 sectors + Broad Market, tagged from headlines (§7.3) |
| Watchlist filter | v1 | Stored on the phone only; matches company names in headlines |
| Pull to refresh | v1 | Reads the server cache; phones never hit publisher feeds |
| Sources / About screen | v1 | Every publisher, privacy policy, contact; required for Play |
| Push alert when a watchlist stock is in the news | v1.1 | Needs FCM + server-side watchlist |
| Saved / bookmarked headlines | v1.1 | Local only |
| Search | v1.1 | Headline text, last 90 days |
| Daily AI morning brief | Later | Generated once a day for all users; themes only, no stock calls |
| Accounts and cross-device sync | Later | Only if users ask |
| More sources and languages (Hindi) | Later | After checking each publisher's terms |

---

## 4. Screens (v1)

| Screen | Shows | Actions |
| --- | --- | --- |
| **Feed (home)** | India / Global tabs; each row = headline, publisher, time ago, sector tags, "+N sources" | Tap → article in browser; pull to refresh; sector chips filter the list |
| **My stocks** | Feed filtered to watchlist companies; empty state explains how to add stocks | Toggle All / My stocks |
| **Watchlist** | Searchable list of NSE companies with on/off switches | Add / remove; stored in `localStorage` |
| **About / Sources** | Every publisher linked to its site, refresh frequency, privacy policy, contact email, "not investment advice" note | Open publisher sites; send feedback (mailto) |

Tapping "+N sources" expands the row to list each outlet's link for that story.

---

## 5. Architecture

```
 Publishers (RSS) ──RSS──▶ Collector (cron */15) ──store──▶ Cloudflare D1
        ▲                                                       │ read
        │ tap a headline                                        ▼
 App (PWA → Android TWA) ◀────── feed ────── Feed API (same Worker, HTTP route)
```

- **One Cloudflare Worker** with two entry points:
  - `scheduled()` — cron `*/15 * * * *`: fetch feeds → parse → dedupe → tag → upsert into D1 → prune > 90 days
  - `fetch()` — read-only JSON API for the app (§8)
- **Cloudflare D1** for storage (§6)
- **PWA** hosted on Cloudflare Pages (or GitHub Pages), installable to home screen
- Phones never contact publisher feeds directly; they only open article URLs

Cron triggers register only via `wrangler deploy` (not `wrangler versions upload`).

---

## 6. Data model (D1 / SQLite)

```sql
CREATE TABLE sources (
  id          TEXT PRIMARY KEY,          -- 'et-markets'
  publisher   TEXT NOT NULL,             -- 'Economic Times'
  section     TEXT,                      -- 'Markets'
  region      TEXT NOT NULL CHECK (region IN ('india','global')),
  feed_url    TEXT NOT NULL,
  enabled     INTEGER NOT NULL DEFAULT 1,
  last_ok_at  INTEGER,                   -- unix seconds of last successful fetch
  fail_count  INTEGER NOT NULL DEFAULT 0 -- consecutive failed runs
);

CREATE TABLE stories (
  id            TEXT PRIMARY KEY,        -- hash of the normalised title of the first copy seen
  title         TEXT NOT NULL,
  region        TEXT NOT NULL,
  sectors       TEXT NOT NULL DEFAULT '[]',  -- JSON array of sector names
  companies     TEXT NOT NULL DEFAULT '[]',  -- JSON array of NSE symbols
  first_seen_at INTEGER NOT NULL
);
CREATE INDEX idx_stories_region_time ON stories(region, first_seen_at DESC);

CREATE TABLE links (
  story_id     TEXT NOT NULL REFERENCES stories(id) ON DELETE CASCADE,
  source_id    TEXT NOT NULL REFERENCES sources(id),
  url          TEXT NOT NULL UNIQUE,
  published_at INTEGER,                  -- publisher's own time, unix seconds
  PRIMARY KEY (story_id, source_id)
);
```

A small `meta(key, value)` table holds run metadata such as `last_run_at` (see `worker/schema.sql`).

Retention: delete stories whose `first_seen_at` is older than 90 days at the end of each run.
The watchlist is **not** stored server-side in v1.

---

## 7. Collector logic

### 7.1 Feeds (seed `sources`)

| id | Publisher · section | Region | Feed URL |
| --- | --- | --- | --- |
| et-markets | Economic Times · Markets | india | https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms |
| et-stocks | Economic Times · Stocks | india | https://economictimes.indiatimes.com/markets/stocks/rssfeeds/2146842.cms |
| et-economy | Economic Times · Economy | india | https://economictimes.indiatimes.com/news/economy/rssfeeds/1373380680.cms |
| mint-markets | Mint · Markets | india | https://www.livemint.com/rss/markets |
| bs-markets | Business Standard · Markets | india | https://www.business-standard.com/rss/markets-106.rss |
| ft-markets | Financial Times · Markets | global | https://www.ft.com/markets?format=rss |
| yahoo-indices | Yahoo Finance | global | https://feeds.finance.yahoo.com/rss/2.0/headline?s=^NSEI,^GSPC&region=US&lang=en-US |
| cnbc-markets | CNBC · Markets | global | https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258 |
| cnbc-top | CNBC · Top News | global | https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=100003114 |

Known feed issues (verified 2026-10-13):
- **Moneycontrol** `rss/marketreports.xml` returns an HTML page, not RSS — excluded.
- **Yahoo Finance** `news/rssindex` returns 404 — use the per-symbol headline feed above.
  Its items are often syndicated from other outlets (e.g. Investing.com).
- **Business Standard** ships unescaped `&` — sanitise before parsing.
- **FT** — check terms before inclusion (§9); disable via `sources.enabled` if needed.

### 7.2 Fetch, parse, dedupe

1. Fetch every enabled feed in parallel. Headers:
   `User-Agent: FinStreet/1.0 (+<contact email>)`,
   `Accept: application/rss+xml, application/xml, text/xml, */*`. Timeout 15 s.
2. Sanitise before parsing: decode as UTF-8 with replacement; replace bare `&` not
   starting an entity (`&(?!#\d+;|#x[0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)`) with `&amp;`.
   Workers have no `DOMParser` → use `fast-xml-parser`. Handle RSS 2.0 `<item>` and Atom `<entry>`.
3. Per item keep only: `title` (HTML-unescaped, whitespace-collapsed), `link`, `pubDate`/`updated`.
   **Discard `description`.** Drop items without title or link, or older than 90 days.
4. On success set `last_ok_at = now`, `fail_count = 0`; on failure `fail_count += 1`
   and log. A response that isn't XML (e.g. HTML) counts as a failure.
5. Dedupe:
   - Exact: same `url` already in `links` → skip.
   - Same story: normalised title = lowercase, strip non-`[a-z0-9 ]`, drop stopwords;
     compare token sets against stories from the last 36 h in the same region.
     Jaccard ≥ 0.6 (tunable) → attach as a new `links` row on the existing story.
   - Otherwise insert a new story.

### 7.3 Sector tagging

Case-insensitive whole-word match (`\b(?:kw1|kw2|…)\b`) on the **title only**.
A sector is tagged when at least one keyword matches; return up to 2 sectors, most
matches first. If no sector matches but a broad-market term does, tag `Broad Market`.

Broad-market terms: `sensex, nifty, dalal street, stock market, stock markets, wall street,
s&p 500, nasdaq, dow jones, ipo, listing, lists, smallcap, midcap, bull market, bear market`

```json
{
  "Banking & Finance": ["bank","banks","banking","lender","lenders","nbfc","loan","loans","credit","deposit","deposits","insurance","insurer","fintech","mutual fund","mutual funds","hdfc","icici","sbi","kotak","axis bank","bajaj finance","shriram finance","upi","npci","payments","paytm","mobikwik","pine labs","broking","brokerage","gilts","amc","sebi","mf","jpmorgan","goldman","morgan stanley","citigroup","wells fargo","bank of america"],
  "IT & Tech": ["tech","technology","software","it services","ai","artificial intelligence","semiconductor","semiconductors","chip","chips","chipmaker","cloud","data centre","data center","infosys","tcs","wipro","hcl","tech mahindra","ltimindtree","nvidia","microsoft","apple","google","alphabet","meta","amazon","openai","tsmc"],
  "Energy & Oil": ["energy","oil","crude","brent","opec","gas","lng","petrol","diesel","fuel","refinery","refiner","power","electricity","renewable","solar","coal","ongc","reliance","adani green","ntpc","tata power","exxon","chevron","bp","shell"],
  "Industrials & Cap Goods": ["capital goods","industrial","industrials","engineering","engines","machinery","cable","cables","wire","polycab","kei","siemens","abb","bhel","cummins","transmission","electricals","manufacturing","boeing"],
  "Agri & Chemicals": ["agri","agriculture","agrochemical","farm","farmers","fertiliser","fertilizer","crop","crops","monsoon","sugar","kharif","rabi","chemical","chemicals","upl","bayer","pi industries"],
  "Auto": ["auto","autos","automaker","carmaker","car","cars","ev","evs","electric vehicle","two-wheeler","tata motors","maruti","mahindra","hero motocorp","bajaj auto","tesla","toyota","ford","general motors"],
  "Pharma & Healthcare": ["pharma","pharmaceutical","drug","drugs","drugmaker","healthcare","hospital","hospitals","vaccine","medical","biotech","fda","sun pharma","cipla","dr reddy","lupin","j&j","johnson & johnson","pfizer","eli lilly"],
  "Metals & Mining": ["metal","metals","steel","aluminium","aluminum","copper","zinc","iron ore","mining","miner","tata steel","jsw steel","hindalco","vedanta"],
  "Commodities & Gold": ["gold","silver","commodity","commodities","bullion","precious metals"],
  "FMCG & Consumer": ["fmcg","consumer","retail","retailer","e-commerce","ecommerce","food","beverage","hindustan unilever","hul","itc","nestle","dabur","titan","dmart","walmart","flipkart"],
  "Telecom & Media": ["telecom","5g","airtel","bharti","jio","vodafone idea","media","streaming","netflix"],
  "Real Estate & Infra": ["real estate","realty","housing","property","infrastructure","infra","construction","cement","railway","railways","dlf","larsen","l&t","ultratech","adani ports","logistics","gatishakti"],
  "Defence": ["defence","defense","hal","bel","bharat electronics","missile"],
  "Crypto": ["crypto","bitcoin","ethereum","cryptocurrency","stablecoin","blockchain"],
  "Economy & Policy": ["rbi","fed","federal reserve","ecb","rate cut","rate hike","interest rate","interest rates","inflation","cpi","gdp","growth","recession","rupee","dollar","yield","yields","bond","bonds","tariff","tariffs","trade deal","budget","fiscal","imf","debt","economy","economic","jobs","unemployment","fx","forex"]
}
```

Keep this in `worker/src/sectors.json` so it can be tuned without code changes.

### 7.4 Company matching (watchlist)

- Seed `worker/src/companies.json`: Nifty 100 to start — `{ "symbol": "HDFCBANK", "name": "HDFC Bank", "aliases": ["hdfc bank"] }`.
- Match aliases + name (whole-word, case-insensitive) against the title → `stories.companies`.
- The app filters `My stocks` client-side using `companies`.
- Watch for ambiguous aliases (e.g. "ITC", "Titan", "Bharti") — prefer multi-word aliases.

---

## 8. Feed API

All responses JSON, CORS open to the app origin, `Cache-Control: public, max-age=60`.

| Method · path | Params | Returns |
| --- | --- | --- |
| `GET /api/feed` | `region=india\|global` (required), `sector=<name>` (optional), `before=<unix>` (pagination), `limit` (default 50, max 100) | `{ stories: [ { id, title, region, sectors, companies, first_seen_at, links: [ { publisher, section, url, published_at } ] } ], next_before }` |
| `GET /api/sources` | — | `[ { id, publisher, section, region, last_ok_at } ]` (for About screen) |
| `GET /api/meta` | — | `{ sectors: [...], companies: [ { symbol, name } ], last_run_at }` |

Ordering: `first_seen_at DESC`. Story `links` ordered by `published_at ASC` (first publisher first).

---

## 9. Content rules (launch checklist)

- [ ] Headline, publisher, time and link only; RSS descriptions stripped before storing
- [ ] Articles open in the browser / Custom Tab, never an in-app WebView
- [ ] Publisher names as plain text; no logos or brand colours
- [ ] Each feed fetched by the server at most every 15 min, identifying User-Agent + contact
- [ ] Every source named and linked on the About screen
- [ ] Remove a source within 48 h if its publisher asks (`sources.enabled = 0`)
- [ ] Read each publisher's terms; exclude any that forbid aggregation (check FT carefully)
- [ ] No buy / sell / hold calls anywhere; "not investment advice" on About screen
- [ ] Short legal review before public Play release

---

## 10. Project structure

```
market-news-aggregator/
├── SPEC.md
├── worker/
│   ├── wrangler.toml          # D1 binding, cron "*/15 * * * *"
│   ├── schema.sql             # §6
│   ├── seed.sql               # §7.1 sources
│   └── src/
│       ├── index.ts           # scheduled() + fetch() entry points
│       ├── collector.ts       # fetch, sanitise, parse (§7.2)
│       ├── dedupe.ts          # title normalisation + Jaccard (§7.2)
│       ├── tagging.ts         # sectors (§7.3) + companies (§7.4)
│       ├── api.ts             # §8 routes
│       ├── sectors.json
│       └── companies.json
└── web/                       # PWA, no build step (vanilla JS)
    ├── index.html
    ├── app.js
    ├── styles.css
    ├── manifest.webmanifest
    ├── sw.js                  # offline shell + last feed cached
    └── icons/
```

---

## 11. Phases and exit criteria

1. **Build the PWA** — Worker, D1, the four screens, installable.
   *Exit:* feed refreshes every 15 min for 7 days straight with no missed runs.
2. **Private testing** — owner + 10–20 traders use it daily.
   *Exit:* ≥ 50 % of testers still open it 3+ times a week after 3 weeks.
3. **Play closed test** — wrap PWA as a TWA (Bubblewrap), Play developer account ($25),
   closed test (12+ testers for 14 days on new personal accounts), store listing,
   privacy policy, data-safety form.
   *Exit:* closed test complete; listing approved.
4. **Public release** — publish; add v1.1 (push alerts, bookmarks, search) from feedback.
   *Exit:* decide on native app, AI brief and more sources from real usage numbers.

---

## 12. Costs

| Item | Cost | When |
| --- | --- | --- |
| Cloudflare Worker + cron + D1 | Free tier (approx. 100k requests/day, 5 GB D1 — confirm on Cloudflare pricing) | Phase 1 |
| PWA hosting (Cloudflare Pages / GitHub Pages) | Free | Phase 1 |
| Own domain (optional) | approx. ₹800–1,200 / year | Before Play launch |
| Google Play developer account | US$25 one-time | Phase 3 |
| Push (Firebase Cloud Messaging) | Free | v1.1 |
| Daily AI morning brief (one shared call/day) | approx. US$0.03–1.20 / month by model | Later |
| Legal review | One-off, varies | Before public release |

---

## 13. Risks and open questions

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Too similar to Pulse by Zerodha | High | Lead on watchlist + sector filters; validate in phase 2 before Play spend |
| Publisher objects or blocks the feed | Medium | Links-only, fast removal, enough sources to lose one |
| Feeds change format or break | High | `fail_count` health check; alert after 3 consecutive failures |
| Headline-only tagging misses or mislabels | Medium | Grow keyword + company lists; AI tagging later |
| Play rejects the news-app declaration | Low | About screen with sources, contact, privacy policy from day one |

Open questions:
- [ ] App name, and whether to buy a domain
- [ ] Final v1 source list after reading each publisher's terms (especially FT)
- [ ] Should the stock-analyser email digest move onto this backend later?
- [ ] Who are the first 10–20 testers?
- [ ] Failure alert channel (email via Resend? Telegram?)

---

## 14. v1 acceptance criteria

- [ ] Cron runs every 15 min; each run logs per-source item counts and failures
- [ ] No stored row contains RSS description text
- [ ] The same story from two outlets appears once with both links
- [ ] `/api/feed?region=india` returns ≤ 90 days of stories, newest first, in < 300 ms (p95)
- [ ] Sector chip filters and My stocks filter work offline from the last cached feed
- [ ] Tapping a headline opens the publisher URL outside the app
- [ ] About screen lists every enabled source with a link, privacy policy and contact
- [ ] Lighthouse PWA installable check passes on Android Chrome
