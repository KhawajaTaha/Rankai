import { db } from "../db";
import { addDays, clamp, daysBetween } from "../utils";

/** Client health score (spec §61) — 0-100 plus the components that drove it. */
export async function computeClientHealth(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { locations: { include: { account: { include: { connection: true } } } }, integrations: true } });
  const now = new Date();
  const [unanswered, openCriticalIssues, overdueFollowUps, recentContent, keywords, openAlerts, overdueTasks] = await Promise.all([
    db.gbpReview.count({ where: { clientId, replyStatus: { in: ["UNANSWERED", "DRAFTED", "NEEDS_APPROVAL"] } } }),
    db.seoIssue.count({ where: { clientId, status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
    db.followUp.count({ where: { clientId, completedAt: null, dueAt: { lt: now } } }),
    db.contentItem.count({ where: { clientId, status: "PUBLISHED", publishedAt: { gte: addDays(now, -30) } } }),
    db.keyword.findMany({ where: { clientId }, select: { currentPosition: true, previousPosition: true } }),
    db.alert.count({ where: { clientId, status: { not: "RESOLVED" }, severity: { in: ["CRITICAL", "HIGH"] } } }),
    db.task.count({ where: { clientId, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { lt: now } } }),
  ]);
  const gbpConnected = client.locations.some((l) => l.account.connection.status === "CONNECTED");
  const brokenIntegrations = client.integrations.filter((i) => ["ERROR", "EXPIRED", "DISCONNECTED"].includes(i.status)).length;
  const ranked = keywords.filter((k) => k.currentPosition != null);
  const avgPos = ranked.length ? ranked.reduce((s, k) => s + k.currentPosition!, 0) / ranked.length : null;
  const drops = keywords.filter((k) => k.currentPosition && k.previousPosition && k.currentPosition - k.previousPosition >= 5).length;

  const components = {
    gbp: client.gbpScore ?? (gbpConnected ? 60 : 30),
    website: client.seoScore ?? 50,
    rankings: avgPos == null ? 50 : clamp(Math.round(100 - (avgPos - 1) * 4.5) - drops * 5, 0, 100),
    reviews: clamp(100 - unanswered * 8, 0, 100),
    content: clamp(recentContent * 15 + 25, 0, 100),
    integrations: clamp((gbpConnected ? 70 : 20) + (client.integrations.length ? 30 : 0) - brokenIntegrations * 35, 0, 100),
    openIssues: clamp(100 - openCriticalIssues * 6 - openAlerts * 10, 0, 100),
    support: clamp(100 - overdueFollowUps * 20 - overdueTasks * 5, 0, 100),
  };
  const weights = { gbp: 0.18, website: 0.15, rankings: 0.15, reviews: 0.12, content: 0.1, integrations: 0.1, openIssues: 0.1, support: 0.1 };
  const score = Math.round((Object.keys(weights) as (keyof typeof weights)[]).reduce((s, k) => s + components[k] * weights[k], 0));
  const label = score >= 80 ? "Healthy" : score >= 60 ? "Needs Attention" : "At Risk";
  return { score, label, components, signals: { unanswered, openCriticalIssues, overdueFollowUps, recentContent, drops, openAlerts, overdueTasks, gbpConnected, brokenIntegrations, daysSinceContact: client.lastContactAt ? daysBetween(client.lastContactAt, now) : null } };
}

export function healthLabel(score: number | null | undefined) {
  if (score == null) return { label: "Unknown", tone: "gray" as const };
  if (score >= 80) return { label: "Healthy", tone: "green" as const };
  if (score >= 60) return { label: "Needs Attention", tone: "amber" as const };
  return { label: "At Risk", tone: "red" as const };
}
