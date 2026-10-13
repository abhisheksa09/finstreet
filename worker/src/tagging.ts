// Sector + company tagging from headline text only (SPEC §7.3, §7.4).
import sectorKeywords from "./sectors.json";
import companyList from "./companies.json";

export const BROAD_MARKET = "Broad Market";
const MAX_SECTORS = 2;

export interface Company {
  symbol: string;
  name: string;
  aliases: string[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-word, case-insensitive alternation of the given phrases. */
function wordRegex(phrases: string[]): RegExp {
  return new RegExp(`\\b(?:${phrases.map(escape).join("|")})\\b`, "gi");
}

const SECTOR_RES: [string, RegExp][] = Object.entries(sectorKeywords as Record<string, string[]>)
  .map(([sector, kws]) => [sector, wordRegex(kws)]);

const BROAD_RE = wordRegex([
  "sensex", "nifty", "dalal street", "stock market", "stock markets", "wall street",
  "s&p 500", "nasdaq", "dow jones", "ipo", "listing", "lists", "smallcap", "midcap",
  "bull market", "bear market",
]);

export const COMPANIES = companyList as Company[];
const COMPANY_RES: [string, RegExp][] = COMPANIES
  .map(c => [c.symbol, wordRegex([c.name.toLowerCase(), ...c.aliases])]);

export const SECTORS = [...SECTOR_RES.map(([s]) => s), BROAD_MARKET];

/** Curly quotes → straight, so "Dr Reddy’s" matches "dr reddy's". */
const normaliseQuotes = (s: string) => s.replace(/[‘’]/g, "'");

/** Up to 2 sectors, most keyword hits first; Broad Market only when nothing else matches. */
export function tagSectors(title: string): string[] {
  const text = normaliseQuotes(title);
  const scored = SECTOR_RES
    .map(([sector, re]) => [sector, text.match(re)?.length ?? 0] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (scored.length) return scored.slice(0, MAX_SECTORS).map(([s]) => s);
  BROAD_RE.lastIndex = 0;
  return BROAD_RE.test(text) ? [BROAD_MARKET] : [];
}

/** NSE symbols whose name or alias appears in the headline. */
export function tagCompanies(title: string): string[] {
  const text = normaliseQuotes(title);
  return COMPANY_RES.filter(([, re]) => { re.lastIndex = 0; return re.test(text); }).map(([sym]) => sym);
}
