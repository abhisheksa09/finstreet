// Scheduled collector: fetch every enabled feed, group copies of the same story,
// tag, store, and prune anything older than 48 hours (SPEC §7).
import type { Env } from "./index";
import { fetchFeed, type FeedItem } from "./feeds";
import { findSameStory, storyId, titleTokens, type Candidate } from "./dedupe";
import { tagCompanies, tagSectors } from "./tagging";

const RETENTION_S = 48 * 3600;     // keep 48 h of headlines
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

export async function runCollector(env: Env): Promise<RunSummary> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - RETENTION_S;

  const sources = (await env.DB
    .prepare("SELECT id, region, feed_url, fail_count FROM sources WHERE enabled = 1")
    .all<SourceRow>()).results;

  const fetched = await Promise.allSettled(sources.map(s => fetchFeed(s.feed_url, env.CONTACT_EMAIL)));

  // Current state: every stored URL, and recent stories to match new headlines against.
  const knownUrls = new Set(
    (await env.DB.prepare("SELECT url FROM links").all<{ url: string }>()).results.map(r => r.url),
  );
  const recent = (await env.DB
    .prepare("SELECT id, title, region FROM stories WHERE first_seen_at >= ?")
    .bind(now - MATCH_WINDOW_S)
    .all<{ id: string; title: string; region: string }>()).results;
  const candidates = new Map<string, Candidate[]>();
  for (const r of recent) {
    if (!candidates.has(r.region)) candidates.set(r.region, []);
    candidates.get(r.region)!.push({ id: r.id, tokens: titleTokens(r.title) });
  }

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

  // Oldest first, so the outlet that published first owns the story and its title.
  fresh.sort((a, b) => (a.item.publishedAt ?? now) - (b.item.publishedAt ?? now));
  const created = new Set<string>();

  for (const { source, item } of fresh) {
    const tokens = titleTokens(item.title);
    if (!candidates.has(source.region)) candidates.set(source.region, []);
    const regionCandidates = candidates.get(source.region)!;

    let id = findSameStory(tokens, regionCandidates);
    if (!id) {
      id = await storyId(item.title);
      if (!created.has(id)) {
        created.add(id);
        regionCandidates.push({ id, tokens });
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
