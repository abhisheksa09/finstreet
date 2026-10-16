// Same-story detection across outlets (SPEC §7.2 step 5).

/** Two titles with token-set Jaccard similarity at or above this are one story. Tunable. */
export const SAME_STORY_THRESHOLD = 0.6;

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "for", "from", "has", "have", "in", "is",
  "it", "its", "of", "on", "or", "over", "says", "the", "to", "up", "was", "what", "why",
  "how", "will", "with", "after", "amid", "into", "than", "this", "that", "here",
  "s", "vs", "new", "now", "today",
]);

/** Lowercase, strip punctuation, drop stopwords and 1-char tokens. */
export function titleTokens(title: string): Set<string> {
  const words = title
    .toLowerCase()
    .replace(/[‘’']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(w => w.length > 1 && !STOPWORDS.has(w));
  return new Set(words);
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const t of a) if (b.has(t)) shared++;
  return shared / (a.size + b.size - shared);
}

export interface Candidate {
  id: string;
  tokens: Set<string>;
}

/** Best existing story at or above the threshold, or null. */
export function findSameStory(
  tokens: Set<string>,
  candidates: Candidate[],
  threshold = SAME_STORY_THRESHOLD,
): string | null {
  let best: string | null = null;
  let bestScore = threshold;
  for (const c of candidates) {
    const score = jaccard(tokens, c.tokens);
    if (score >= bestScore) {
      best = c.id;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Candidates indexed by token, so a headline is only scored against stories sharing a word
 * with it (a Jaccard score above 0 needs one). Same result as findSameStory over all of them.
 */
export class StoryIndex {
  private candidates: Candidate[] = [];
  private byToken = new Map<string, number[]>();

  add(c: Candidate): void {
    const i = this.candidates.push(c) - 1;
    for (const t of c.tokens) {
      const list = this.byToken.get(t);
      if (list) list.push(i);
      else this.byToken.set(t, [i]);
    }
  }

  find(tokens: Set<string>, threshold = SAME_STORY_THRESHOLD): string | null {
    const hits = new Set<number>();
    for (const t of tokens) for (const i of this.byToken.get(t) ?? []) hits.add(i);
    // Insertion order, so ties resolve exactly as findSameStory does.
    const subset = [...hits].sort((a, b) => a - b).map(i => this.candidates[i]);
    return findSameStory(tokens, subset, threshold);
  }
}

/** Stable story id: first 16 hex chars of SHA-256 over the sorted title tokens. */
export async function storyId(title: string): Promise<string> {
  const key = [...titleTokens(title)].sort().join(" ") || title.toLowerCase();
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));
  return [...new Uint8Array(digest)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}
