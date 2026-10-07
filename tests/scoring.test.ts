import { describe, expect, it } from "vitest";
import { scoreGbp } from "@/lib/scoring/gbp";
import { auditCrawl } from "@/lib/scoring/website";
import { crawlSite } from "@/lib/integrations/crawler";

describe("GBP score", () => {
  const complete = { title: "X", description: "A".repeat(650) + " Thunder Bay", primaryCategory: "Plumber", additionalCategories: 2, services: ["Drain Cleaning", "Water Heaters"], knownServices: ["Drain Cleaning", "Water Heaters"], hasHours: true, hasPhone: true, hasWebsite: true, hasAddressOrArea: true, photoCount: 30, recentPhotoCount: 5, reviewCount: 80, avgRating: 4.8, unansweredReviews: 0, daysSinceLastPost: 2, websiteMentionsPrimaryService: true, descriptionMentionsCity: true, city: "Thunder Bay" };
  it("scores a complete, active profile highly", () => {
    const s = scoreGbp(complete);
    expect(s.score).toBeGreaterThanOrEqual(90);
    expect(s.issues).toHaveLength(0);
  });
  it("flags missing services, unanswered reviews and stale posts", () => {
    const s = scoreGbp({ ...complete, services: [], unansweredReviews: 12, daysSinceLastPost: 17 });
    const codes = s.issues.map((i) => i.code);
    expect(codes).toEqual(expect.arrayContaining(["missing_services", "unanswered_reviews", "stale_posts"]));
    expect(s.issues.find((i) => i.code === "stale_posts")!.title).toBe("No post in 17 days");
    expect(s.score).toBeLessThan(scoreGbp(complete).score);
  });
  it("treats a missing primary category as critical", () => {
    expect(scoreGbp({ ...complete, primaryCategory: null }).issues[0]!.severity).toBe("CRITICAL");
  });
});

describe("website audit", () => {
  it("finds issues on the demo crawl and scores 0-100", async () => {
    const crawl = await crawlSite("https://www.demo.example/", { demo: true, seed: "t", services: ["Drain Cleaning"], city: "Thunder Bay" });
    const a = auditCrawl(crawl, { city: "Thunder Bay", services: ["Drain Cleaning", "Emergency Plumbing"], homepage: crawl.pages[0]!.url });
    expect(a.score).toBeGreaterThanOrEqual(0);
    expect(a.score).toBeLessThanOrEqual(100);
    expect(a.issues.some((i) => i.code === "missing_service_page")).toBe(true);
    expect(Object.keys(a.breakdown)).toEqual(expect.arrayContaining(["technical", "on_page", "content", "links", "images", "schema", "performance", "local"]));
  });
});
