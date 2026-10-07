import type { SupportHealth } from "@prisma/client";

export const SUPPORT_HEALTH: Record<SupportHealth, { label: string; tone: "green" | "amber" | "red" | "blue" | "purple" | "gray" }> = {
  HEALTHY: { label: "Healthy", tone: "green" },
  NEEDS_FOLLOW_UP: { label: "Needs Follow-Up", tone: "amber" },
  WAITING_FOR_CLIENT: { label: "Waiting for Client", tone: "purple" },
  SEO_ATTENTION_NEEDED: { label: "SEO Attention Needed", tone: "amber" },
  URGENT: { label: "Urgent", tone: "red" },
  NEW_CLIENT: { label: "New Client", tone: "blue" },
};

export const STAGE_LABEL: Record<string, string> = {
  NEW_CLIENT: "New Client",
  INFORMATION_REQUIRED: "Information Required",
  GBP_CONNECTION_PENDING: "GBP Connection Pending",
  WEBSITE_CONNECTION_PENDING: "Website Connection Pending",
  GSC_CONNECTION_PENDING: "GSC Connection Pending",
  GA4_CONNECTION_PENDING: "GA4 Connection Pending",
  INITIAL_AUDIT_RUNNING: "Initial Audit Running",
  RECOMMENDATIONS_GENERATED: "Recommendations Generated",
  AWAITING_APPROVAL: "Awaiting Approval",
  OPTIMIZATION_STARTED: "Optimization Started",
  FULLY_ACTIVE: "Fully Active",
};

export const LEVEL_LABEL: Record<string, string> = {
  MONITOR_ONLY: "Monitor Only",
  ASSIST: "Assist Mode",
  APPROVAL_AUTOPILOT: "Approval Autopilot",
  FULL_SAFE_AUTOPILOT: "Full Safe Autopilot",
};

export function pretty(s: string | null | undefined) {
  if (!s) return "—";
  return s.replace(/[_.]/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
}
