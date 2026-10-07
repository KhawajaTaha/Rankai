import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, AI_ACTOR } from "../audit";
import { loadBrain } from "../ai/brain";
import { generateWeeklyStrategy, StrategySchema } from "../ai/generators";
import { ACTIONS } from "../engine/risk";
import { addDays, startOfWeek } from "../utils";
import type { z } from "zod";

/**
 * Weekly AI SEO strategy (spec §53): gathers every signal for the client and produces the
 * top-5 priorities with why / impact / risk / auto-approval-manual mode.
 */
export async function weeklyStrategy(clientId: string) {
  const brain = await loadBrain(clientId);
  const since = addDays(new Date(), -30);
  const [issues, openRecs, executed, keywords, reviews, pendingApprovals, notes, gsc, lastPost] = await Promise.all([
    db.seoIssue.groupBy({ by: ["severity"], where: { clientId, status: "OPEN" }, _count: true }),
    db.aiRecommendation.findMany({ where: { clientId, status: { in: ["PROPOSED", "NEEDS_APPROVAL", "SCHEDULED"] } }, orderBy: [{ severity: "asc" }, { confidence: "desc" }], take: 15 }),
    db.seoAction.findMany({ where: { clientId, createdAt: { gte: since } }, select: { field: true, target: true, measuredOutcome: true, createdAt: true } }),
    db.keyword.findMany({ where: { clientId }, select: { phrase: true, currentPosition: true, previousPosition: true } }),
    db.gbpReview.findMany({ where: { clientId, reviewedAt: { gte: since } }, select: { rating: true, replyStatus: true } }),
    db.approval.count({ where: { clientId, status: "PENDING" } }),
    db.knowledgeEntry.findMany({ where: { clientId, active: true }, take: 5, orderBy: { createdAt: "desc" }, select: { content: true } }),
    db.gscMetric.aggregate({ where: { clientId, date: { gte: since } }, _sum: { clicks: true, impressions: true } }),
    db.contentItem.findFirst({ where: { clientId, type: "GBP_POST", status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } }),
  ]);
  const signals = {
    gbpScore: brain.client.gbpScore, seoScore: brain.client.seoScore, healthScore: brain.client.healthScore,
    openIssues: Object.fromEntries(issues.map((i) => [i.severity, i._count])),
    pendingApprovals,
    openRecommendations: openRecs.map((r) => ({ action: r.action, title: r.title, confidence: r.confidence, severity: r.severity })),
    changesLast30Days: executed.map((e) => ({ field: e.field, target: e.target, outcome: e.measuredOutcome })),
    keywords: keywords.map((k) => ({ k: k.phrase, pos: k.currentPosition, prev: k.previousPosition })),
    reviewsLast30Days: { count: reviews.length, unanswered: reviews.filter((r) => r.replyStatus !== "POSTED").length, low: reviews.filter((r) => r.rating <= 3).length },
    searchConsole30d: gsc._sum,
    daysSinceLastPost: lastPost?.publishedAt ? Math.floor((Date.now() - lastPost.publishedAt.getTime()) / 86_400_000) : null,
    supportNotes: notes.map((n) => n.content),
  };
  const recentlyChanged = new Set(executed.map((e) => e.target));
  const fallback = (): z.infer<typeof StrategySchema> => {
    const pri: z.infer<typeof StrategySchema>["priorities"] = [];
    for (const r of openRecs.filter((x) => !recentlyChanged.has(x.target ?? "")).slice(0, 4)) {
      const m = ACTIONS[r.action];
      pri.push({ title: r.title, why: r.reason, expectedImpact: r.expectedImpact ?? r.seoBenefit ?? "Improves local visibility", risk: (m?.risk === "CRITICAL" ? "HIGH" : m?.risk ?? "MEDIUM") as "LOW" | "MEDIUM" | "HIGH", mode: m?.actionClass === "AUTO_SAFE" ? "AUTO" : m?.actionClass === "PROTECTED" ? "MANUAL" : "APPROVAL", action: r.action });
    }
    if (signals.reviewsLast30Days.unanswered) pri.unshift({ title: `Reply to ${signals.reviewsLast30Days.unanswered} unanswered review(s)`, why: "Unanswered reviews hurt trust and the GBP response score.", expectedImpact: "Higher conversion from Maps", risk: "LOW", mode: "APPROVAL", action: "reply_review_positive" });
    if (signals.daysSinceLastPost == null || signals.daysSinceLastPost > 7) pri.push({ title: "Publish a GBP post this week", why: `Last post was ${signals.daysSinceLastPost ?? "never"} days ago.`, expectedImpact: "Keeps the profile active and fresh", risk: "LOW", mode: "AUTO", action: "generate_gbp_post" });
    const prioritized = brain.prioritized[0];
    if (prioritized && pri.length < 5) pri.push({ title: `Promote ${prioritized} across GBP and website`, why: "Marked as a priority service in the client brain.", expectedImpact: "More leads for the priority service", risk: "LOW", mode: "AUTO", action: "generate_gbp_post" });
    if (!pri.length) pri.push({ title: "Maintain cadence and monitor rankings", why: "No urgent issues detected.", expectedImpact: "Stable growth", risk: "LOW", mode: "AUTO", action: "manual" });
    return { summary: `This week focuses on ${pri[0]!.title.toLowerCase()}${pri[1] ? ` and ${pri[1].title.toLowerCase()}` : ""}. ${pendingApprovals ? `${pendingApprovals} item(s) are waiting for approval.` : "Nothing is blocked on approvals."}`, priorities: pri.slice(0, 5) };
  };
  const result = await generateWeeklyStrategy(brain, signals, fallback);
  const weekOf = startOfWeek();
  const strat = await db.weeklyStrategy.upsert({
    where: { clientId_weekOf: { clientId, weekOf } },
    create: { organizationId: brain.client.organizationId, clientId, weekOf, summary: result.data.summary, priorities: result.data.priorities.map((p, i) => ({ rank: i + 1, ...p })) as Prisma.InputJsonValue, inputs: signals as Prisma.InputJsonValue, generatedBy: result.mode === "LIVE" ? "AI" : "DEMO" },
    update: { summary: result.data.summary, priorities: result.data.priorities.map((p, i) => ({ rank: i + 1, ...p })) as Prisma.InputJsonValue, inputs: signals as Prisma.InputJsonValue },
  });
  await activity({ organizationId: brain.client.organizationId, clientId, category: "AI", type: "strategy.weekly", title: "This week's SEO plan generated", detail: result.data.summary, actor: AI_ACTOR });
  return strat;
}

/**
 * Feedback loop (spec §54): after the observation window, compare rankings/clicks for the
 * changed target and mark the action IMPROVED / NO_CHANGE / DECLINED.
 */
export async function measureAction(seoActionId: string) {
  const a = await db.seoAction.findUnique({ where: { id: seoActionId } });
  if (!a || a.status === "ROLLED_BACK") return { skipped: true };
  const before = { from: addDays(a.createdAt, -28), to: a.createdAt };
  const after = { from: a.createdAt, to: new Date() };
  const agg = (r: { from: Date; to: Date }) => db.gscMetric.aggregate({ where: { clientId: a.clientId, page: a.target, date: { gte: r.from, lt: r.to } }, _sum: { clicks: true, impressions: true }, _avg: { position: true } });
  const [b, c] = await Promise.all([agg(before), agg(after)]);
  let outcome = "NO_CHANGE";
  const bc = b._sum.clicks ?? 0;
  const cc = c._sum.clicks ?? 0;
  const bp = b._avg.position;
  const cp = c._avg.position;
  if ((bp && cp && bp - cp >= 1.5) || (bc > 5 && cc > bc * 1.2)) outcome = "IMPROVED";
  else if ((bp && cp && cp - bp >= 2) || (bc > 5 && cc < bc * 0.7)) outcome = "DECLINED";
  await db.seoAction.update({ where: { id: a.id }, data: { measuredOutcome: outcome } });
  if (a.recommendationId) await db.aiRecommendation.update({ where: { id: a.recommendationId }, data: { outcome: `Measured: ${outcome}` } });
  await activity({ organizationId: a.organizationId, clientId: a.clientId, category: "AI", type: "feedback.measured", title: `Impact measured: ${outcome.replace("_", " ").toLowerCase()}`, detail: `${a.field} on ${a.target}`, actor: AI_ACTOR });
  return { outcome };
}
