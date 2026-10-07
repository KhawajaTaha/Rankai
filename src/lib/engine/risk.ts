import type { ActionClass, AutomationLevel, AutomationSetting, ClientConsent, RiskLevel } from "@prisma/client";

/**
 * The action catalog is the single source of truth for what the AI is allowed to do.
 * Anything not in this catalog cannot be executed. PROTECTED actions are never executed by
 * automation — they always become manual tasks (spec §96 guardrails).
 */
export interface ActionMeta {
  label: string;
  domain: "GBP" | "WEBSITE" | "CONTENT" | "REVIEWS" | "RANKINGS" | "STRATEGY";
  actionClass: ActionClass;
  risk: RiskLevel;
  consent?: (keyof Omit<ClientConsent, "id" | "organizationId" | "clientId" | "recordedById" | "recordedAt" | "history">)[];
  /** Major changes start an observation cooldown on the target (spec §55). */
  major?: boolean;
  /** Requires a backup snapshot before execution (spec §32). */
  backup?: boolean;
  rollbackable: boolean;
  approvalCategory: "GBP" | "WEBSITE" | "CONTENT" | "REVIEWS" | "IMAGES" | "TECHNICAL";
}

export const ACTIONS: Record<string, ActionMeta> = {
  // GBP
  update_gbp_description: { label: "Update GBP description", domain: "GBP", actionClass: "APPROVAL_REQUIRED", risk: "MEDIUM", consent: ["gbpProfileEdits"], major: true, rollbackable: true, approvalCategory: "GBP" },
  add_gbp_services: { label: "Add missing GBP services", domain: "GBP", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["gbpProfileEdits"], rollbackable: true, approvalCategory: "GBP" },
  add_gbp_secondary_category: { label: "Add GBP secondary category", domain: "GBP", actionClass: "APPROVAL_REQUIRED", risk: "MEDIUM", consent: ["gbpProfileEdits"], major: true, rollbackable: true, approvalCategory: "GBP" },
  update_gbp_hours: { label: "Update GBP hours", domain: "GBP", actionClass: "APPROVAL_REQUIRED", risk: "MEDIUM", consent: ["gbpProfileEdits"], rollbackable: true, approvalCategory: "GBP" },
  change_gbp_primary_category: { label: "Change primary GBP category", domain: "GBP", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", consent: ["gbpProfileEdits"], major: true, rollbackable: true, approvalCategory: "GBP" },
  change_business_identity: { label: "Change business name / address / identity", domain: "GBP", actionClass: "PROTECTED", risk: "CRITICAL", rollbackable: false, approvalCategory: "GBP" },
  // Reviews
  reply_review_positive: { label: "Reply to positive review", domain: "REVIEWS", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["positiveReviewReplies"], rollbackable: false, approvalCategory: "REVIEWS" },
  reply_review_negative: { label: "Reply to critical review", domain: "REVIEWS", actionClass: "APPROVAL_REQUIRED", risk: "MEDIUM", rollbackable: false, approvalCategory: "REVIEWS" },
  // Website — safe
  update_meta_description: { label: "Improve meta description", domain: "WEBSITE", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["websiteMetadataChanges"], rollbackable: true, approvalCategory: "WEBSITE" },
  update_image_alt: { label: "Add image alt text", domain: "WEBSITE", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["websiteMetadataChanges"], rollbackable: true, approvalCategory: "WEBSITE" },
  add_internal_link: { label: "Add internal link", domain: "WEBSITE", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["internalLinking"], rollbackable: true, approvalCategory: "WEBSITE" },
  add_faq_schema: { label: "Add FAQ schema", domain: "WEBSITE", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["websiteMetadataChanges"], rollbackable: true, approvalCategory: "TECHNICAL" },
  add_local_business_schema: { label: "Add LocalBusiness schema", domain: "WEBSITE", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["websiteMetadataChanges"], rollbackable: true, approvalCategory: "TECHNICAL" },
  fix_broken_link: { label: "Fix broken internal link", domain: "WEBSITE", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["websiteMetadataChanges"], rollbackable: true, approvalCategory: "TECHNICAL" },
  // Website — approval
  update_seo_title: { label: "Improve SEO title", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "MEDIUM", consent: ["websiteMetadataChanges"], major: true, rollbackable: true, approvalCategory: "WEBSITE" },
  update_h1: { label: "Change H1", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", major: true, backup: true, rollbackable: true, approvalCategory: "WEBSITE" },
  rewrite_page_content: { label: "Rewrite / expand page content", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", major: true, backup: true, rollbackable: true, approvalCategory: "WEBSITE" },
  change_canonical: { label: "Change canonical", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", major: true, backup: true, rollbackable: true, approvalCategory: "TECHNICAL" },
  change_indexing: { label: "Change index/noindex", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", major: true, backup: true, rollbackable: true, approvalCategory: "TECHNICAL" },
  add_redirect: { label: "Add redirect", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", major: true, rollbackable: true, approvalCategory: "TECHNICAL" },
  change_url: { label: "Change page URL", domain: "WEBSITE", actionClass: "APPROVAL_REQUIRED", risk: "HIGH", major: true, backup: true, rollbackable: true, approvalCategory: "TECHNICAL" },
  delete_page: { label: "Delete page", domain: "WEBSITE", actionClass: "PROTECTED", risk: "CRITICAL", rollbackable: false, approvalCategory: "WEBSITE" },
  change_domain: { label: "Change domain", domain: "WEBSITE", actionClass: "PROTECTED", risk: "CRITICAL", rollbackable: false, approvalCategory: "TECHNICAL" },
  mass_rewrite: { label: "Mass rewrite website", domain: "WEBSITE", actionClass: "PROTECTED", risk: "CRITICAL", rollbackable: false, approvalCategory: "WEBSITE" },
  // Content
  create_supporting_blog: { label: "Create supporting blog draft", domain: "CONTENT", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["blogs"], rollbackable: true, approvalCategory: "CONTENT" },
  generate_gbp_post: { label: "Generate GBP post", domain: "CONTENT", actionClass: "AUTO_SAFE", risk: "LOW", consent: ["gbpAutoPosting"], rollbackable: true, approvalCategory: "CONTENT" },
  // Manual / strategy
  manual_task: { label: "Manual task", domain: "STRATEGY", actionClass: "PROTECTED", risk: "LOW", rollbackable: false, approvalCategory: "TECHNICAL" },
};

export type Decision =
  | { mode: "AUTO"; reason: string }
  | { mode: "APPROVAL"; reason: string; requiresClient: boolean }
  | { mode: "MANUAL"; reason: string }
  | { mode: "MONITOR"; reason: string }
  | { mode: "DEFER"; reason: string; until: Date }
  | { mode: "REJECT"; reason: string };

export interface DecisionInput {
  action: string;
  confidence: number;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  safetyIssues?: string[];
  automationPaused: boolean;
  clientStatus: string;
  level: AutomationLevel;
  consent: ClientConsent | null;
  settings: AutomationSetting | null;
  minAutoConfidence: number;
  cooldownUntil: Date | null;
}

/**
 * Risk engine (spec §92): Validation → Risk → Client permission (consent) → Automation level →
 * Confidence → Cooldown → decision. Pure function so it is easy to test and audit.
 */
export function decide(i: DecisionInput): Decision {
  const meta = ACTIONS[i.action];
  if (!meta) return { mode: "REJECT", reason: `Unknown action "${i.action}" — not in the allowed action catalog` };
  if (i.confidence < 0 || i.confidence > 1) return { mode: "REJECT", reason: "Invalid confidence value" };
  if (["ARCHIVED", "OFFBOARDING"].includes(i.clientStatus)) return { mode: "REJECT", reason: "Client is offboarding/archived" };

  if (meta.actionClass === "PROTECTED") return { mode: "MANUAL", reason: `${meta.label} is a protected action — manual only` };

  if (i.cooldownUntil && i.cooldownUntil > new Date() && meta.major && i.severity !== "CRITICAL") {
    return { mode: "DEFER", reason: `Target is in its observation period after a recent major change`, until: i.cooldownUntil };
  }

  if (i.level === "MONITOR_ONLY") return { mode: "MONITOR", reason: "Client is in Monitor Only mode" };

  const missingConsent = (meta.consent ?? []).filter((c) => !i.consent?.[c]);
  const humanReasons: string[] = [];
  if (i.level === "ASSIST") humanReasons.push("Assist mode — humans execute");
  if (i.automationPaused) humanReasons.push("Automation is paused for this client");
  if (meta.actionClass === "APPROVAL_REQUIRED" && !(i.level === "FULL_SAFE_AUTOPILOT" && meta.risk === "LOW")) humanReasons.push(`${meta.label} requires approval (${meta.risk.toLowerCase()} risk)`);
  if (missingConsent.length) humanReasons.push(`Client consent not given: ${missingConsent.join(", ")}`);
  if (i.confidence < i.minAutoConfidence) humanReasons.push(`Confidence ${(i.confidence * 100).toFixed(0)}% below auto threshold ${(i.minAutoConfidence * 100).toFixed(0)}%`);
  if (i.safetyIssues?.length) humanReasons.push(`Content safety: ${i.safetyIssues.join("; ")}`);
  if (meta.risk === "HIGH" || meta.risk === "CRITICAL") humanReasons.push("High-risk change");
  if (meta.domain === "REVIEWS" && i.settings?.reviewAutoReply === "NEVER") return { mode: "MANUAL", reason: "Review auto-reply is set to Never" };
  if (meta.domain === "WEBSITE" && meta.actionClass === "AUTO_SAFE" && i.settings && !i.settings.websiteSafeFixes) humanReasons.push("Website safe auto-fixes are disabled for this client");

  if (humanReasons.length) return { mode: "APPROVAL", reason: humanReasons.join(" · "), requiresClient: meta.risk === "HIGH" || meta.risk === "CRITICAL" || meta.domain === "GBP" };
  return { mode: "AUTO", reason: `Auto-safe action within consent and confidence (${(i.confidence * 100).toFixed(0)}%)` };
}

export function classifyAction(action: string) {
  return ACTIONS[action] ?? null;
}
