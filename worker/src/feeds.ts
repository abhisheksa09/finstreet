// Fetch + parse RSS 2.0 / Atom feeds into headline-only items (SPEC §7.2 steps 1–3).
// Descriptions are deliberately never read: the app stores headlines and links only.
//
// A small purpose-built extractor rather than a full XML parser: we only need each item's
// title, link and date, and a general parser spent ~50 ms of CPU per run on 9 feeds,
// far over the Workers free-plan 10 ms budget. This takes ~2 ms.

export interface FeedItem {
  title: string;
  url: string;
  publishedAt: number | null; // unix seconds
}

const FETCH_TIMEOUT_MS = 15_000;

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

// RSS <item> / RDF <item> / Atom <entry>, with their contents. Comments are stripped first.
const ITEM_RE = /<(item|entry)(?:\s[^>]*)?>([\s\S]*?)<\/\1\s*>/g;
const COMMENT_RE = /<!--[\s\S]*?-->/g;

export function parseFeed(xml: string): FeedItem[] {
  // Some publishers answer a dead feed URL with an HTML page (Moneycontrol): treat as failure.
  if (!/<(rss|feed|rdf:RDF)[\s>]/i.test(xml.slice(0, 2000))) {
    throw new Error("response is not an RSS/Atom feed");
  }

  const items: FeedItem[] = [];
  for (const [, kind, body] of xml.replace(COMMENT_RE, "").matchAll(ITEM_RE)) {
    if (kind === "item") {
      items.push({
        title: cleanText(elementText(body, "title")),
        url: elementText(body, "link").trim(),
        publishedAt: toUnix(elementText(body, "pubDate") || elementText(body, "dc:date")),
      });
    } else {
      items.push({
        title: cleanText(elementText(body, "title")),
        url: atomLink(body),
        publishedAt: toUnix(elementText(body, "updated") || elementText(body, "published")),
      });
    }
  }
  return items.filter(i => i.title && /^https?:\/\//i.test(i.url));
}

const elementRes = new Map<string, RegExp>();

/** Text of the first <name> element directly in `body`, XML-decoded once ("" if absent). */
function elementText(body: string, name: string): string {
  let re = elementRes.get(name);
  if (!re) {
    // `<title` but not `<media:title` or `<titleX`; tolerates attributes and `</title >`.
    re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}\\s*>`);
    elementRes.set(name, re);
  }
  const m = re.exec(body);
  return m ? xmlText(m[1]) : "";
}

/**
 * Character data of an element: CDATA sections taken literally, everything else entity-decoded.
 * CDATA is re-escaped and then decoded with the rest, so both end up decoded exactly once.
 */
function xmlText(raw: string): string {
  const escaped = raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, (_, cdata: string) =>
    cdata.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"));
  return decodeEntities(escaped);
}

/** Atom: the rel="alternate" (or rel-less) link's href, else the first link's. */
function atomLink(body: string): string {
  const links = [...body.matchAll(/<link\s([^>]*?)\/?>/g)].map(m => attrs(m[1]));
  const alt = links.find(l => !l.rel || l.rel === "alternate") ?? links[0];
  return (alt?.href ?? "").trim();
}

function attrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, k, , v] of s.matchAll(/([\w:-]+)\s*=\s*(["'])([\s\S]*?)\2/g)) out[k] = decodeEntities(v);
  return out;
}

const ENTITIES: Record<string, string> = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  // The HTML entities publishers use in headlines.
  copy: "©", reg: "®", trade: "™", mdash: "—", ndash: "–", hellip: "…", laquo: "«", raquo: "»",
  lsquo: "‘", rsquo: "’", ldquo: "“", rdquo: "”", bull: "•", deg: "°",
  cent: "¢", pound: "£", yen: "¥", euro: "€", inr: "₹",
};

/** Decode XML/HTML entities, leaving unknown ones and bare '&' (Business Standard) as they are. */
function decodeEntities(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#\d+|#x[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/**
 * Strip any HTML tags left in a title, decode leftover entities (Mint double-encodes, so
 * "F&amp;amp;O" arrives as "F&amp;O" after the first decode) and collapse whitespace.
 */
function cleanText(s: string): string {
  return decodeEntities(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function toUnix(s: string): number | null {
  if (!s) return null;
  const ms = Date.parse(s.trim());
  return Number.isNaN(ms) ? null : Math.floor(ms / 1000);
}
