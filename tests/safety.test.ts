import { describe, expect, it } from "vitest";
import { checkClaims, sanitizeForAvoidList } from "@/lib/ai/safety";
import { screenImagePrompt, buildImagePrompt } from "@/lib/images/safety";
import { topicSimilarity, normalizeTopic } from "@/lib/utils";

describe("content claim safety", () => {
  it("flags guarantees, superlatives and medical claims", () => {
    expect(checkClaims("We guarantee results and are the #1 dentist").issues.length).toBeGreaterThanOrEqual(2);
    expect(checkClaims("Pain-free treatment that cures everything").safe).toBe(false);
    expect(checkClaims("Friendly local plumbing help in Thunder Bay").safe).toBe(true);
  });
  it("enforces words to avoid and do-not-promote lists", () => {
    const r = checkClaims("Cheap teeth whitening this week", { wordsToAvoid: ["cheap"], doNotPromote: ["Teeth Whitening"] });
    expect(r.issues).toHaveLength(2);
    expect(sanitizeForAvoidList("A cheap and fast service", ["cheap"])).toBe("A and fast service");
  });
});

describe("AI image safety", () => {
  it("refuses misleading business imagery", () => {
    for (const p of ["our team photo in the office", "award trophy for best plumber", "before and after kitchen results", "certificate of accreditation", "customer testimonial card", "exterior of our storefront"]) {
      expect(screenImagePrompt(p).allowed).toBe(false);
    }
    expect(screenImagePrompt("Premium kitchen with quartz countertops").allowed).toBe(true);
  });
  it("builds prompts that exclude people, text and fake signage", () => {
    const p = buildImagePrompt({ concept: "clean sink", industry: "plumbing", style: "Photo-realistic", brandColors: ["#000000"], addText: false });
    expect(p).toContain("No text");
    expect(p).toContain("No identifiable people");
  });
});

describe("content memory", () => {
  it("detects repetitive topics", () => {
    expect(topicSimilarity("Granite countertops in Thunder Bay", "Thunder Bay granite countertops")).toBeGreaterThan(0.6);
    expect(topicSimilarity("Granite countertops in Thunder Bay", "Emergency drain cleaning tips")).toBeLessThan(0.2);
    expect(normalizeTopic("The BEST guide to Quartz!")).toBe("quartz");
  });
});
