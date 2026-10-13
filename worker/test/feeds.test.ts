import { describe, expect, it } from "vitest";
import { parseFeed } from "../src/feeds";

const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel><title>Markets</title>
  <item>
    <title><![CDATA[SMIDs rally heats up bets in IPO & secondary mkt]]></title>
    <link>https://example.com/a</link>
    <description>Full summary text that must never be stored</description>
    <pubDate>Tue, 13 Oct 2026 16:09:35 +0530</pubDate>
  </item>
  <item>
    <title>Rupee &amp; bonds steady</title>
    <link>https://example.com/b</link>
  </item>
</channel></rss>`;

const atom = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <title>Chip stocks slide</title>
    <link rel="alternate" href="https://example.com/c"/>
    <updated>2026-10-13T10:33:41Z</updated>
  </entry>
</feed>`;

describe("parseFeed", () => {
  it("parses RSS items into headline, link and time only", () => {
    const items = parseFeed(rss);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({
      title: "SMIDs rally heats up bets in IPO & secondary mkt",
      url: "https://example.com/a",
      publishedAt: Math.floor(Date.parse("2026-10-13T10:39:35Z") / 1000),
    });
    expect(JSON.stringify(items)).not.toContain("summary text");
  });

  it("repairs bare ampersands (Business Standard)", () => {
    const broken = rss.replace("Rupee &amp; bonds", "Rupee & bonds");
    expect(parseFeed(broken)[1].title).toBe("Rupee & bonds steady");
  });

  it("decodes double-encoded entities (Mint)", () => {
    const doubled = rss.replace("Rupee &amp; bonds", "F&amp;amp;O: M&amp;amp;M &amp;#8377;500");
    expect(parseFeed(doubled)[1].title).toBe("F&O: M&M ₹500 steady");
  });

  it("parses Atom entries", () => {
    expect(parseFeed(atom)).toEqual([{
      title: "Chip stocks slide",
      url: "https://example.com/c",
      publishedAt: Math.floor(Date.parse("2026-10-13T10:33:41Z") / 1000),
    }]);
  });

  it("rejects an HTML page served at a feed URL (Moneycontrol)", () => {
    expect(() => parseFeed("<!DOCTYPE html><html><head></head><body>hi</body></html>"))
      .toThrow(/not an RSS/);
  });
});
