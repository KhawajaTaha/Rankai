import { db } from "../db";
import { computeClientHealth } from "../scoring/health";
import { raiseAlert } from "../notify";
import { createTask } from "../tasks";
import { addDays } from "../utils";
import { updateSupportHealth } from "./support";

export interface RiskFlag {
  code: string;
  label: string;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

/**
 * "No work forgotten" watchdog (spec §52). Returns at-risk clients with the reasons, and
 * (when act=true) creates the follow-up tasks so nothing silently slips.
 */
export async function scanClients(organizationId: string, opts: { act?: boolean; clientIds?: string[] } = {}) {
  const now = new Date();
  const clients = await db.client.findMany({
    where: { organizationId, archivedAt: null, status: { in: ["ACTIVE", "ONBOARDING"] }, ...(opts.clientIds ? { id: { in: opts.clientIds } } : {}) },
    include: { automation: true, locations: { include: { account: { include: { connection: true } } } }, integrations: true },
  });
  const out: { clientId: string; name: string; flags: RiskFlag[] }[] = [];
  for (const c of clients) {
    const flags: RiskFlag[] = [];
    const [lastPost, lastWork, overdueFollowUps, oldApprovals, unanswered, failedRuns, criticalIssues, lastReport] = await Promise.all([
      db.contentItem.findFirst({ where: { clientId: c.id, type: "GBP_POST", status: "PUBLISHED" }, orderBy: { publishedAt: "desc" }, select: { publishedAt: true } }),
      db.seoAction.findFirst({ where: { clientId: c.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.followUp.count({ where: { clientId: c.id, completedAt: null, dueAt: { lt: now } } }),
      db.approval.count({ where: { clientId: c.id, status: "PENDING", createdAt: { lt: addDays(now, -5) } } }),
      db.gbpReview.count({ where: { clientId: c.id, replyStatus: { not: "POSTED" }, reviewedAt: { lt: addDays(now, -2) } } }),
      db.automationRun.count({ where: { clientId: c.id, status: { in: ["FAILED", "NEEDS_HUMAN"] }, createdAt: { gte: addDays(now, -7) } } }),
      db.seoIssue.count({ where: { clientId: c.id, status: "OPEN", severity: "CRITICAL", firstSeenAt: { lt: addDays(now, -7) } } }),
      db.report.findFirst({ where: { clientId: c.id, status: { in: ["READY", "SENT"] } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
    ]);
    const hasGbp = c.locations.length > 0;
    if (hasGbp && c.automation?.gbpPostingEnabled && (!lastPost?.publishedAt || lastPost.publishedAt < addDays(now, -14))) flags.push({ code: "no_gbp_post", label: "No GBP post in 14+ days", severity: "HIGH" });
    if (c.status === "ACTIVE" && (!lastWork || lastWork.createdAt < addDays(now, -30))) flags.push({ code: "no_seo_work", label: "No SEO work in 30 days", severity: "MEDIUM" });
    if (c.automation?.monthlyReport && (!lastReport || lastReport.createdAt < addDays(now, -35))) flags.push({ code: "report_overdue", label: "Monthly report overdue", severity: "HIGH" });
    if (overdueFollowUps) flags.push({ code: "followup_overdue", label: `${overdueFollowUps} overdue follow-up(s)`, severity: "HIGH" });
    const broken = [...c.locations.filter((l) => l.account.connection.status !== "CONNECTED").map(() => "GBP"), ...c.integrations.filter((i) => ["ERROR", "EXPIRED", "DISCONNECTED"].includes(i.status)).map((i) => i.kind)];
    if (broken.length) flags.push({ code: "broken_integration", label: `Broken integration: ${[...new Set(broken)].join(", ")}`, severity: "CRITICAL" });
    if (failedRuns) flags.push({ code: "failed_automation", label: `${failedRuns} failed automation job(s)`, severity: "HIGH" });
    if (oldApprovals) flags.push({ code: "stale_approvals", label: `${oldApprovals} approval(s) pending 5+ days`, severity: "MEDIUM" });
    if (unanswered) flags.push({ code: "unanswered_reviews", label: `${unanswered} review(s) unanswered 48h+`, severity: unanswered > 3 ? "HIGH" : "MEDIUM" });
    if (criticalIssues) flags.push({ code: "unresolved_seo", label: `${criticalIssues} critical SEO issue(s) unresolved 7+ days`, severity: "HIGH" });
    if (c.status === "ONBOARDING" && c.createdAt < addDays(now, -14)) flags.push({ code: "stalled_onboarding", label: "Onboarding stalled (14+ days)", severity: "HIGH" });
    if (flags.length) out.push({ clientId: c.id, name: c.name, flags });

    if (opts.act) {
      for (const f of flags) {
        if (f.code === "unanswered_reviews") await createTask({ organizationId, clientId: c.id, title: `Reviews unanswered for 48h+ (${unanswered})`, category: "Review", priority: "HIGH", source: "WATCHDOG", dedupeKey: `wd:reviews:${c.id}` });
        if (f.code === "stale_approvals") await createTask({ organizationId, clientId: c.id, title: `Chase ${oldApprovals} pending approval(s)`, category: "Approval", priority: "NORMAL", source: "WATCHDOG", dedupeKey: `wd:approvals:${c.id}` });
        if (f.code === "stalled_onboarding") await createTask({ organizationId, clientId: c.id, title: "Onboarding is stalled — contact client", category: "Onboarding", priority: "HIGH", source: "WATCHDOG", dedupeKey: `wd:onboarding:${c.id}` });
        if (f.code === "no_gbp_post") await createTask({ organizationId, clientId: c.id, title: "No GBP post in 14+ days — check posting automation", category: "Content", priority: "HIGH", source: "WATCHDOG", dedupeKey: `wd:posts:${c.id}` });
        if (f.code === "report_overdue") await createTask({ organizationId, clientId: c.id, title: "Monthly report overdue", category: "Support", priority: "HIGH", source: "WATCHDOG", dedupeKey: `wd:report:${c.id}` });
      }
      if (flags.some((f) => f.severity === "CRITICAL")) {
        await raiseAlert({ organizationId, clientId: c.id, severity: "HIGH", type: "client_at_risk", title: `${c.name} needs attention`, detail: flags.map((f) => f.label).join(" · "), dedupeKey: `atrisk:${c.id}:${now.toISOString().slice(0, 10)}` });
      }
    }
  }
  const order = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  return out.sort((a, b) => Math.min(...a.flags.map((f) => order[f.severity])) - Math.min(...b.flags.map((f) => order[f.severity])) || b.flags.length - a.flags.length);
}

export async function updateHealth(clientId: string) {
  const h = await computeClientHealth(clientId);
  await db.client.update({ where: { id: clientId }, data: { healthScore: h.score } });
  await updateSupportHealth(clientId);
  return h;
}
