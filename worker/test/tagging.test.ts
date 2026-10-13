import { describe, expect, it } from "vitest";
import { BROAD_MARKET, tagCompanies, tagSectors } from "../src/tagging";

describe("tagSectors", () => {
  it("tags a sector from a single headline keyword", () => {
    expect(tagSectors("Shriram Finance rallies 7%; what's driving NBFC stock price?"))
      .toEqual(["Banking & Finance"]);
  });

  it("returns at most two sectors, most hits first", () => {
    const tags = tagSectors("Bitcoin and crypto slide as bond yields and inflation fears rise");
    expect(tags).toHaveLength(2);
    expect(tags[0]).toBe("Economy & Policy"); // bond, yields, inflation
    expect(tags[1]).toBe("Crypto");            // bitcoin, crypto
  });

  it("matches whole words only", () => {
    expect(tagSectors("Carnival shares jump on strong bookings")).not.toContain("Auto"); // 'car' inside 'Carnival'
  });

  it("falls back to Broad Market for index-only headlines", () => {
    expect(tagSectors("Sensex ends 300 points higher; Nifty above 25,000")).toEqual([BROAD_MARKET]);
  });

  it("returns nothing for unrelated headlines", () => {
    expect(tagSectors("Nobel prize awarded to two scientists")).toEqual([]);
  });
});

describe("tagCompanies", () => {
  it("matches names and aliases, case-insensitively", () => {
    expect(tagCompanies("HDFC Bank and Infosys lead gains")).toEqual(["HDFCBANK", "INFY"]);
  });

  it("handles curly apostrophes", () => {
    expect(tagCompanies("Dr Reddy’s Q2 profit beats estimates")).toEqual(["DRREDDY"]);
  });

  it("matches symbols with ampersands", () => {
    expect(tagCompanies("L&T wins order worth Rs 5,000 crore")).toContain("LT");
  });
});
