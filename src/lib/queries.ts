import "server-only";
import { db } from "./db";
import type { Ctx } from "./auth";
import { clientScopeFilter, clientWhere } from "./tenancy";
import { addDays, startOfDay } from "./utils";

/** "Your attention is needed" — the exception-first summary (spec §103). */
export async function attentionSummary(ctx: Ctx) {
  const scope = await clientScopeFilter(ctx);
  const now = new Date();
  const [approvals, brokenGoogle, brokenIntegrations, urgentReviews, websiteProblems, followUps, requests, failedRuns, criticalAlerts] = await Promise.all([
    db.approval.count({ where: { ...scope, status: "PENDING" } }),
    db.googleConnection.count({ where: { organizationId: ctx.orgId, status: { not: "CONNECTED" } } }),
    db.integration.count({ where: { ...scope, status: { in: ["ERROR", "EXPIRED", "DISCONNECTED"] } } }),
    db.gbpReview.count({ where: { ...scope, rating: { lte: 3 }, replyStatus: { not: "POSTED" } } }),
    db.alert.count({ where: { ...scope, status: "OPEN", type: { in: ["website_offline", "ssl_expiring", "robots_blocking", "site_slow"] } } }),
    db.followUp.count({ where: { ...scope, completedAt: null, dueAt: { lt: addDays(startOfDay(), 1) } } }),
    db.supportTicket.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.automationRun.count({ where: { ...scope, status: { in: ["FAILED", "NEEDS_HUMAN"] }, createdAt: { gte: addDays(now, -14) } } }),
    db.alert.count({ where: { ...scope, status: "OPEN", severity: "CRITICAL" } }),
  ]);
  return { approvals, brokenGoogle: brokenGoogle + brokenIntegrations, urgentReviews, websiteProblems, followUps, requests, failedRuns, criticalAlerts };
}

/** Automation success / ROI counters for a period (spec §102). */
export async function automationWins(orgId: string, since: Date, clientIds?: string[] | null) {
  const c = clientIds ? { clientId: { in: clientIds } } : {};
  const [posts, images, replies, blogs, fixes, links, reports] = await Promise.all([
    db.contentItem.count({ where: { organizationId: orgId, ...c, type: "GBP_POST", status: "PUBLISHED", publishedAt: { gte: since } } }),
    db.aiGeneratedImage.count({ where: { organizationId: orgId, ...c, createdAt: { gte: since } } }),
    db.gbpReview.count({ where: { organizationId: orgId, ...c, replyStatus: "POSTED", repliedAt: { gte: since } } }),
    db.contentItem.count({ where: { organizationId: orgId, ...c, type: "BLOG", status: { in: ["PUBLISHED", "SCHEDULED", "NEEDS_APPROVAL"] }, createdAt: { gte: since } } }),
    db.seoAction.count({ where: { organizationId: orgId, ...c, createdAt: { gte: since }, status: { not: "ROLLED_BACK" } } }),
    db.seoAction.count({ where: { organizationId: orgId, ...c, field: "add_internal_link", createdAt: { gte: since } } }),
    db.report.count({ where: { organizationId: orgId, ...c, createdAt: { gte: since }, status: { in: ["READY", "SENT"] } } }),
  ]);
  return { posts, images, replies, blogs, fixes, links, reports };
}

/** Assigned clients with everything the support dashboard needs (spec §4). */
export async function supportClientRows(ctx: Ctx, opts: { onlyMine?: boolean } = {}) {
  const where = opts.onlyMine ? { organizationId: ctx.orgId, archivedAt: null, assignments: { some: { memberId: ctx.memberId } } } : clientWhere(ctx);
  const clients = await db.client.findMany({
    where,
    orderBy: { name: "asc" },
    include: {
      locations: { include: { account: { include: { connection: { select: { status: true } } } } }, take: 1 },
      notes: { orderBy: { createdAt: "desc" }, take: 1, select: { body: true, createdAt: true } },
      _count: { select: { tasks: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } }, tickets: { where: { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"] } } } } },
    },
  });
  return clients;
}

export async function memberNames(orgId: string) {
  const rows = await db.organizationUser.findMany({ where: { organizationId: orgId }, include: { user: { select: { name: true, email: true } }, role: { select: { name: true, key: true } } } });
  return new Map(rows.map((r) => [r.id, { name: r.user.name, email: r.user.email, role: r.role.name, roleKey: r.role.key }]));
}

export async function clientAssignmentsMap(clientIds: string[]) {
  const rows = await db.clientAssignment.findMany({ where: { clientId: { in: clientIds } }, include: { member: { include: { user: { select: { name: true } } } } } });
  const map = new Map<string, { support?: string; seo?: string; supportId?: string; seoId?: string }>();
  for (const r of rows) {
    const e = map.get(r.clientId) ?? {};
    if (r.type === "SUPPORT") {
      e.support = r.member.user.name;
      e.supportId = r.memberId;
    }
    if (r.type === "SEO") {
      e.seo = r.member.user.name;
      e.seoId = r.memberId;
    }
    map.set(r.clientId, e);
  }
  return map;
}
