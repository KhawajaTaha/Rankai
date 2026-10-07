import { describe, expect, it } from "vitest";
import type { AutomationSetting, ClientConsent } from "@prisma/client";
import { ACTIONS, decide, type DecisionInput } from "@/lib/engine/risk";

const consentAll = { gbpAutoPosting: true, aiImages: true, positiveReviewReplies: true, websiteMetadataChanges: true, internalLinking: true, blogs: true, autoPublishing: true, reports: true, rankTracking: true, gbpProfileEdits: true } as unknown as ClientConsent;
const settings = { websiteSafeFixes: true, reviewAutoReply: "AUTO_POSITIVE" } as unknown as AutomationSetting;
const base: DecisionInput = { action: "update_meta_description", confidence: 0.9, severity: "MEDIUM", automationPaused: false, clientStatus: "ACTIVE", level: "APPROVAL_AUTOPILOT", consent: consentAll, settings, minAutoConfidence: 0.8, cooldownUntil: null };

describe("risk engine", () => {
  it("auto-executes safe actions with consent and confidence", () => {
    expect(decide(base).mode).toBe("AUTO");
  });
  it("rejects actions outside the catalog", () => {
    expect(decide({ ...base, action: "drop_database" }).mode).toBe("REJECT");
  });
  it("never automates protected actions", () => {
    for (const a of ["delete_page", "change_domain", "change_business_identity", "mass_rewrite"]) {
      expect(ACTIONS[a]!.actionClass).toBe("PROTECTED");
      expect(decide({ ...base, action: a, level: "FULL_SAFE_AUTOPILOT", confidence: 0.99 }).mode).toBe("MANUAL");
    }
  });
  it("requires approval below the confidence threshold", () => {
    expect(decide({ ...base, confidence: 0.6 }).mode).toBe("APPROVAL");
  });
  it("requires approval without client consent", () => {
    const d = decide({ ...base, consent: { ...consentAll, websiteMetadataChanges: false } });
    expect(d.mode).toBe("APPROVAL");
    expect(d.reason).toContain("consent");
  });
  it("respects monitor-only and assist levels", () => {
    expect(decide({ ...base, level: "MONITOR_ONLY" }).mode).toBe("MONITOR");
    expect(decide({ ...base, level: "ASSIST" }).mode).toBe("APPROVAL");
  });
  it("holds automation when paused", () => {
    expect(decide({ ...base, automationPaused: true }).mode).toBe("APPROVAL");
  });
  it("primary category change always needs approval even on full autopilot", () => {
    expect(decide({ ...base, action: "change_gbp_primary_category", level: "FULL_SAFE_AUTOPILOT", confidence: 0.99 }).mode).toBe("APPROVAL");
  });
  it("defers major changes during the observation cooldown unless critical", () => {
    const until = new Date(Date.now() + 5 * 86_400_000);
    expect(decide({ ...base, action: "update_seo_title", cooldownUntil: until }).mode).toBe("DEFER");
    expect(decide({ ...base, action: "update_seo_title", cooldownUntil: until, severity: "CRITICAL" }).mode).not.toBe("DEFER");
  });
  it("forces approval when content safety flags claims", () => {
    expect(decide({ ...base, safetyIssues: ["Contains a guarantee claim"] }).mode).toBe("APPROVAL");
  });
  it("never replies to reviews automatically when set to Never", () => {
    expect(decide({ ...base, action: "reply_review_positive", settings: { ...settings, reviewAutoReply: "NEVER" } as AutomationSetting }).mode).toBe("MANUAL");
  });
  it("rejects actions for offboarding clients", () => {
    expect(decide({ ...base, clientStatus: "OFFBOARDING" }).mode).toBe("REJECT");
  });
});
