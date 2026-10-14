// Read-only JSON API for the app (SPEC §8).
import type { Env } from "./index";
import { COMPANIES, SECTORS } from "./tagging";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const REGIONS = new Set(["india", "global"]);
const SYMBOLS = new Set(COMPANIES.map(c => c.symbol));
const MAX_COMPANIES = 100;

interface StoryRow {
  id: string;
  title: string;
  region: string;
  sectors: string;
  companies: string;
  first_seen_at: number;
}

interface LinkRow {
  story_id: string;
  url: string;
  published_at: number | null;
  publisher: string;
  section: string | null;
}

export async function handleApi(req: Request, env: Env): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(env) });
  if (req.method !== "GET") return json({ error: "method not allowed" }, 405, env);

  const url = new URL(req.url);
  try {
    switch (url.pathname) {
      case "/api/feed":    return await feed(url, env);
      case "/api/new":     return await newCount(url, env);
      case "/api/counts":  return await counts(url, env);
      case "/api/sources": return await sources(env);
      case "/api/meta":    return await meta(env);
      default:             return json({ error: "not found" }, 404, env);
    }
  } catch (e) {
    console.error("[api]", url.pathname, e);
    return json({ error: "internal error" }, 500, env);
  }
}

interface Filters {
  region: string | null;
  sector: string | null;
  companies: string[] | null;
}

/**
 * Shared by /api/feed and /api/new. Either `region` (india|global) or `companies`
 * (comma-separated NSE symbols, both regions) is required; `sector` is optional.
 */
function parseFilters(url: URL, env: Env): Filters | Response {
  const region = url.searchParams.get("region");
  if (region && !REGIONS.has(region)) return json({ error: "region must be 'india' or 'global'" }, 400, env);

  const companiesParam = url.searchParams.get("companies");
  const companies = companiesParam
    ? [...new Set(companiesParam.split(",").map(s => s.trim().toUpperCase()).filter(Boolean))]
    : null;
  if (companies && (!companies.length || companies.length > MAX_COMPANIES || companies.some(s => !SYMBOLS.has(s)))) {
    return json({ error: "companies must be up to 100 known NSE symbols" }, 400, env);
  }
  if (!region && !companies) return json({ error: "region or companies is required" }, 400, env);

  const sector = url.searchParams.get("sector");
  if (sector && !SECTORS.includes(sector)) return json({ error: "unknown sector" }, 400, env);

  return { region, sector, companies };
}

// WHERE clause for Filters: ?1 region, ?2 sector, ?3 companies (JSON array).
const FILTER_SQL = `(?1 IS NULL OR region = ?1)
  AND (?2 IS NULL OR EXISTS (SELECT 1 FROM json_each(stories.sectors) WHERE value = ?2))
  AND (?3 IS NULL OR EXISTS (SELECT 1 FROM json_each(stories.companies)
                             WHERE value IN (SELECT value FROM json_each(?3))))`;

const filterArgs = (f: Filters) => [f.region, f.sector, f.companies ? JSON.stringify(f.companies) : null];

/** Stories newest first, filtered as in parseFilters; `before` and `limit` are optional. */
async function feed(url: URL, env: Env): Promise<Response> {
  const filters = parseFilters(url, env);
  if (filters instanceof Response) return filters;

  const before = Number(url.searchParams.get("before") ?? Number.MAX_SAFE_INTEGER);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? DEFAULT_LIMIT) || DEFAULT_LIMIT, 1), MAX_LIMIT);

  const stories = (await env.DB
    .prepare(`SELECT id, title, region, sectors, companies, first_seen_at FROM stories
              WHERE ${FILTER_SQL} AND first_seen_at < ?4
              ORDER BY first_seen_at DESC, id
              LIMIT ?5`)
    .bind(...filterArgs(filters), before, limit)
    .all<StoryRow>()).results;

  const links = stories.length
    ? (await env.DB
        .prepare(`SELECT l.story_id, l.url, l.published_at, s.publisher, s.section
                  FROM links l JOIN sources s ON s.id = l.source_id
                  WHERE l.story_id IN (SELECT value FROM json_each(?1))
                  ORDER BY l.published_at IS NULL, l.published_at ASC`)
        .bind(JSON.stringify(stories.map(s => s.id)))
        .all<LinkRow>()).results
    : [];

  const linksByStory = new Map<string, LinkRow[]>();
  for (const l of links) {
    if (!linksByStory.has(l.story_id)) linksByStory.set(l.story_id, []);
    linksByStory.get(l.story_id)!.push(l);
  }

  return json({
    stories: stories.map(s => ({
      id: s.id,
      title: s.title,
      region: s.region,
      sectors: JSON.parse(s.sectors),
      companies: JSON.parse(s.companies),
      first_seen_at: s.first_seen_at,
      links: (linksByStory.get(s.id) ?? []).map(l => ({
        publisher: l.publisher,
        section: l.section,
        url: l.url,
        published_at: l.published_at,
      })),
    })),
    // Ties on first_seen_at at a page boundary can be skipped; fine for a news feed.
    next_before: stories.length === limit ? stories[stories.length - 1].first_seen_at : null,
  }, 200, env);
}

/**
 * How many stories match the filters and are newer than `since` (unix seconds) — the app polls
 * this to offer "N new headlines" without reloading the whole feed.
 */
async function newCount(url: URL, env: Env): Promise<Response> {
  const filters = parseFilters(url, env);
  if (filters instanceof Response) return filters;
  const since = Number(url.searchParams.get("since"));
  if (!Number.isFinite(since) || since <= 0) return json({ error: "since must be a unix timestamp" }, 400, env);

  const row = await env.DB
    .prepare(`SELECT COUNT(*) AS n FROM stories WHERE ${FILTER_SQL} AND first_seen_at > ?4`)
    .bind(...filterArgs(filters), since)
    .first<{ n: number }>();
  return json({ count: row?.n ?? 0 }, 200, env);
}

/** Stories per region in the last 24 h, optionally for one sector — powers the tab badges. */
async function counts(url: URL, env: Env): Promise<Response> {
  const sector = url.searchParams.get("sector");
  if (sector && !SECTORS.includes(sector)) return json({ error: "unknown sector" }, 400, env);

  const since = Math.floor(Date.now() / 1000) - 86400;
  const rows = (await env.DB
    .prepare(`SELECT region, COUNT(*) AS n FROM stories
              WHERE first_seen_at >= ?2
                AND (?1 IS NULL OR EXISTS (SELECT 1 FROM json_each(stories.sectors) WHERE value = ?1))
              GROUP BY region`)
    .bind(sector, since)
    .all<{ region: string; n: number }>()).results;

  const result: Record<string, number> = { india: 0, global: 0 };
  for (const r of rows) result[r.region] = r.n;
  return json(result, 200, env);
}

async function sources(env: Env): Promise<Response> {
  const rows = (await env.DB
    .prepare(`SELECT id, publisher, section, region, last_ok_at FROM sources
              WHERE enabled = 1 ORDER BY region, publisher, section`)
    .all()).results;
  return json(rows, 200, env);
}

async function meta(env: Env): Promise<Response> {
  const lastRun = await env.DB
    .prepare("SELECT value FROM meta WHERE key = 'last_run_at'")
    .first<{ value: string }>();
  return json({
    sectors: SECTORS,
    companies: COMPANIES.map(c => ({ symbol: c.symbol, name: c.name, industry: c.industry })),
    last_run_at: lastRun ? Number(lastRun.value) : null,
  }, 200, env);
}

function corsHeaders(env: Env): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}

function json(body: unknown, status: number, env: Env): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": status === 200 ? "public, max-age=60" : "no-store",
      ...corsHeaders(env),
    },
  });
}
