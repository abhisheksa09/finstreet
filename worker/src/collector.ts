// Scheduled collector: fetch every enabled feed, group copies of the same story,
// tag, store, and prune anything older than the retention window (SPEC §7).
import type { Env } from "./index";
import { fetchFeed, type FeedItem } from "./feeds";
import { StoryIndex, storyId, titleTokens } from "./dedupe";
import { TAGGING_VERSION, tagCompanies, tagSectors } from "./tagging";

const RETENTION_S = 90 * 86400;    // keep 90 days of headlines (about 0.5 KB each)
const MATCH_WINDOW_S = 36 * 3600;  // look this far back for "same story" matches
const FAIL_ALERT_AFTER = 3;        // consecutive failures before a source is flagged
const BATCH_SIZE = 100;            // statements per D1 batch

interface SourceRow {
  id: string;
  region: string;
  feed_url: string;
  fail_count: number;
}

export interface RunSummary {
  ranAt: number;
  sources: { id: string; ok: boolean; items: number; error?: string }[];
  newStories: number;
  newLinks: number;
}

/** Re-tag every stored headline once after sectors.json / companies.json change. */
async function retagIfNeeded(env: Env): Promise<void> {
  const current = await env.DB
    .prepare("SELECT value FROM meta WHERE key = 'tagging_version'")
    .first<{ value: string }>();
  if (current?.value === TAGGING_VERSION) return;

  const stories = (await env.DB.prepare("SELECT id, title FROM stories").all<{ id: string; title: string }>()).results;
  const stmts = stories.map(s => env.DB
    .prepare("UPDATE stories SET sectors = ?, companies = ? WHERE id = ?")
    .bind(JSON.stringify(tagSectors(s.title)), JSON.stringify(tagCompanies(s.title)), s.id));
  stmts.push(env.DB
    .prepare(`INSERT INTO meta (key, value) VALUES ('tagging_version', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(TAGGING_VERSION));
  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await env.DB.batch(stmts.slice(i, i + BATCH_SIZE));
  }
  console.log(JSON.stringify({ event: "retagged", stories: stories.length, version: TAGGING_VERSION }));
}

export async function runCollector(env: Env): Promise<RunSummary> {
  await retagIfNeeded(env);

  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - RETENTION_S;

  const sources = (await env.DB
    .prepare("SELECT id, region, feed_url, fail_count FROM sources WHERE enabled = 1")
    .all<SourceRow>()).results;

  const fetched = await Promise.allSettled(sources.map(s => fetchFeed(s.feed_url, env.CONTACT_EMAIL)));

  // Which of the URLs we just fetched are already stored. Looked up by URL (indexed) rather than
  // reading every stored link: with 90 days kept, a full scan every 15 min would eat D1's daily read quota.
  const fetchedUrls = fetched.flatMap(r => (r.status === "fulfilled" ? r.value.map(i => i.url) : []));
  const knownUrls = new Set(fetchedUrls.length
    ? (await env.DB
        .prepare("SELECT url FROM links WHERE url IN (SELECT value FROM json_each(?))")
        .bind(JSON.stringify(fetchedUrls))
        .all<{ url: string }>()).results.map(r => r.url)
    : []);

  const stmts: D1PreparedStatement[] = [];
  const summary: RunSummary = { ranAt: now, sources: [], newStories: 0, newLinks: 0 };
  const fresh: { source: SourceRow; item: FeedItem }[] = [];

  fetched.forEach((result, i) => {
    const source = sources[i];
    if (result.status === "fulfilled") {
      stmts.push(env.DB
        .prepare("UPDATE sources SET last_ok_at = ?, fail_count = 0 WHERE id = ?")
        .bind(now, source.id));
      for (const item of result.value) {
        if (knownUrls.has(item.url) || (item.publishedAt ?? now) < cutoff) continue;
        knownUrls.add(item.url);
        fresh.push({ source, item });
      }
      summary.sources.push({ id: source.id, ok: true, items: result.value.length });
    } else {
      const error = String(result.reason?.message ?? result.reason);
      stmts.push(env.DB.prepare("UPDATE sources SET fail_count = fail_count + 1 WHERE id = ?").bind(source.id));
      summary.sources.push({ id: source.id, ok: false, items: 0, error });
      if (source.fail_count + 1 >= FAIL_ALERT_AFTER) {
        console.warn(`[collector] ${source.id} has failed ${source.fail_count + 1} runs in a row: ${error}`);
      }
    }
  });

  // Recent stories to match new headlines against — only needed when something is new,
  // which most runs it isn't (CPU is tight on the Workers free plan).
  const candidates = new Map<string, StoryIndex>();
  const indexFor = (region: string) => {
    if (!candidates.has(region)) candidates.set(region, new StoryIndex());
    return candidates.get(region)!;
  };
  if (fresh.length) {
    const recent = (await env.DB
      .prepare("SELECT id, title, region FROM stories WHERE first_seen_at >= ?")
      .bind(now - MATCH_WINDOW_S)
      .all<{ id: string; title: string; region: string }>()).results;
    for (const r of recent) indexFor(r.region).add({ id: r.id, tokens: titleTokens(r.title) });
  }

  // Oldest first, so the outlet that published first owns the story and its title.
  fresh.sort((a, b) => (a.item.publishedAt ?? now) - (b.item.publishedAt ?? now));
  const created = new Set<string>();

  for (const { source, item } of fresh) {
    const tokens = titleTokens(item.title);
    const regionIndex = indexFor(source.region);

    let id = regionIndex.find(tokens);
    if (!id) {
      id = await storyId(item.title);
      if (!created.has(id)) {
        created.add(id);
        regionIndex.add({ id, tokens });
        stmts.push(env.DB
          .prepare(`INSERT OR IGNORE INTO stories (id, title, region, sectors, companies, first_seen_at)
                    VALUES (?, ?, ?, ?, ?, ?)`)
          .bind(
            id, item.title, source.region,
            JSON.stringify(tagSectors(item.title)),
            JSON.stringify(tagCompanies(item.title)),
            Math.min(now, item.publishedAt ?? now),
          ));
        summary.newStories++;
      }
    }
    stmts.push(env.DB
      .prepare("INSERT OR IGNORE INTO links (story_id, source_id, url, published_at) VALUES (?, ?, ?, ?)")
      .bind(id, source.id, item.url, item.publishedAt));
    summary.newLinks++;
  }

  // Retention + run marker.
  stmts.push(env.DB
    .prepare("DELETE FROM links WHERE story_id IN (SELECT id FROM stories WHERE first_seen_at < ?)")
    .bind(cutoff));
  stmts.push(env.DB.prepare("DELETE FROM stories WHERE first_seen_at < ?").bind(cutoff));
  stmts.push(env.DB
    .prepare(`INSERT INTO meta (key, value) VALUES ('last_run_at', ?)
              ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
    .bind(String(now)));

  for (let i = 0; i < stmts.length; i += BATCH_SIZE) {
    await env.DB.batch(stmts.slice(i, i + BATCH_SIZE));
  }

  console.log(JSON.stringify({ event: "collector_run", ...summary }));
  return summary;
}
