import { describe, expect, it } from "vitest";
import { findSameStory, jaccard, storyId, titleTokens } from "../src/dedupe";

describe("titleTokens", () => {
  it("lowercases, strips punctuation and stopwords", () => {
    expect([...titleTokens("The RBI's rate cut: what it means for EMIs")])
      .toEqual(["rbis", "rate", "cut", "means", "emis"]);
  });
});

describe("findSameStory", () => {
  const a = "Paytm, Pine Labs, Mobikwik shares crash up to 7% as UPI fee rollout delayed";
  const b = "Paytm, Mobikwik, Pine Labs shares crash 7% after UPI fee rollout delayed";
  const c = "Nestle India Q2 preview: strong volumes to drive growth";

  it("treats near-identical headlines from two outlets as one story", () => {
    expect(jaccard(titleTokens(a), titleTokens(b))).toBeGreaterThanOrEqual(0.6);
    expect(findSameStory(titleTokens(b), [{ id: "s1", tokens: titleTokens(a) }])).toBe("s1");
  });

  it("keeps different stories apart", () => {
    expect(findSameStory(titleTokens(c), [{ id: "s1", tokens: titleTokens(a) }])).toBeNull();
  });
});

describe("storyId", () => {
  it("is stable and ignores punctuation and word order", async () => {
    const x = await storyId("Sensex rises 500 points");
    expect(x).toMatch(/^[0-9a-f]{16}$/);
    expect(await storyId("Points rises: Sensex 500!")).toBe(x);
  });
});
