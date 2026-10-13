// Fetch + parse RSS 2.0 / Atom feeds into headline-only items (SPEC §7.2 steps 1–3).
// Descriptions are deliberately never read: the app stores headlines and links only.
import { XMLParser } from "fast-xml-parser";

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: number | null; // unix seconds
}

const FETCH_TIMEOUT_MS = 15_000;

// A bare '&' that doesn't start an entity — Business Standard ships these.
// CDATA sections are matched first and left alone: '&' inside them is already literal.
const CDATA_OR_BARE_AMP = /(<!\[CDATA\[[\s\S]*?\]\]>)|&(?!#\d+;|#x[0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)/g;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  htmlEntities: true,
  // Always arrays, so a feed with a single item parses the same as one with fifty.
  isArray: name => name === "item" || name === "entry" || name === "link",
});

export async function fetchFeed(url: string, contactEmail: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: {
      "User-Agent": `FinStreet/0.1 (+mailto:${contactEmail})`,
      Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml, */*",
    },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  // Decode leniently: invalid UTF-8 bytes become U+FFFD instead of failing the parse.
  const text = new TextDecoder("utf-8").decode(await res.arrayBuffer()); // non-fatal by default
  return parseFeed(text);
}

export function sanitise(xml: string): string {
  return xml
    .replace(/^﻿?\s*<\?xml[^>]*\?>/, "")
    .replace(CDATA_OR_BARE_AMP, (match, cdata) => cdata ?? "&amp;");
}

export function parseFeed(xml: string): FeedItem[] {
  // Some publishers answer a dead feed URL with an HTML page (Moneycontrol): treat as failure.
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) {
    throw new Error("response is not an RSS/Atom feed");
  }
  const doc = parser.parse(sanitise(xml));
  const items: FeedItem[] = [];

  const rssItems: any[] = doc?.rss?.channel?.item ?? doc?.["rdf:RDF"]?.item ?? [];
  for (const it of rssItems) {
    items.push({
      title: cleanText(it.title),
      url: textOf(firstOf(it.link)).trim(),
      publishedAt: toUnix(textOf(it.pubDate ?? it["dc:date"])),
    });
  }

  const atomEntries: any[] = doc?.feed?.entry ?? [];
  for (const e of atomEntries) {
    const links: any[] = e.link ?? [];
    const alt = links.find(l => !l["@_rel"] || l["@_rel"] === "alternate") ?? links[0];
    items.push({
      title: cleanText(e.title),
      url: String(alt?.["@_href"] ?? "").trim(),
      publishedAt: toUnix(textOf(e.updated ?? e.published)),
    });
  }

  return items.filter(i => i.title && /^https?:\/\//i.test(i.url));
}

const firstOf = (v: unknown) => (Array.isArray(v) ? v[0] : v);

/** Node text whether the parser gave a string, a number, or an object with #text. */
function textOf(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "object") return String((v as Record<string, unknown>)["#text"] ?? "");
  return String(v);
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** Decode entities left after XML parsing — Mint double-encodes, so "F&amp;amp;O" arrives as "F&amp;O". */
function decodeEntities(s: string): string {
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Strip any HTML tags left in a title, decode leftover entities and collapse whitespace. */
function cleanText(v: unknown): string {
  return decodeEntities(textOf(v).replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function toUnix(s: string): number | null {
  if (!s) return null;
  const ms = Date.parse(s.trim());
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
