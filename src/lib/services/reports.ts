import type { Prisma, ReportType } from "@prisma/client";
import { db } from "../db";
import { activity, SYSTEM_ACTOR } from "../audit";
import { generateReportSummary } from "../ai/generators";
import { sendEmail } from "../email";
import { env } from "../env";
import { BRAND } from "../brand";
import { addDays, fmtNum } from "../utils";

const TITLES: Record<ReportType, string> = {
  WEEKLY_SUMMARY: "Weekly Summary", MONTHLY_SEO: "Monthly SEO Report", GBP: "Google Business Profile Report", WEBSITE_SEO: "Website SEO Report",
  RANKING: "Ranking Report", CONTENT: "Content Report", SUPPORT: "Support Report", EXECUTIVE: "Executive Report", FINAL: "Final Report",
};

/** Build a client report: what was done / improved / declined / needs attention / planned next (spec §64-66). */
export async function generateReport(clientId: string, type: ReportType, opts: { createdById?: string | null; send?: boolean; start?: Date; end?: Date } = {}) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { automation: true, organization: true, contacts: true } });
  // Custom date range (e.g. "last 30 days" or a picked period); the comparison period has the same length.
  const end = opts.end ?? new Date();
  const start = opts.start ?? addDays(end, type === "WEEKLY_SUMMARY" ? -7 : -30);
  if (start >= end) throw new Error("Report start date must be before the end date");
  const days = Math.max(1, Math.round((end.getTime() - start.getTime()) / 86_400_000));
  const prevStart = addDays(start, -days);
  const report = await db.report.create({ data: { organizationId: client.organizationId, clientId, type, title: `${TITLES[type]} — ${client.name}`, periodStart: start, periodEnd: end, status: "GENERATING", whiteLabel: client.automation?.reportWhiteLabel ?? true, createdById: opts.createdById ?? null } });
  try {
    const inRange = { gte: start, lte: end };
    const [posts, blogs, reviewsReplied, newReviews, fixes, images, keywords, gbpNow, gbpPrev, gscNow, gscPrev, grids, calls, tickets, openIssues, nextContent, strategy] = await Promise.all([
      db.contentItem.count({ where: { clientId, type: "GBP_POST", status: "PUBLISHED", publishedAt: inRange } }),
      db.contentItem.count({ where: { clientId, type: "BLOG", status: "PUBLISHED", publishedAt: inRange } }),
      db.gbpReview.count({ where: { clientId, replyStatus: "POSTED", repliedAt: inRange } }),
      db.gbpReview.findMany({ where: { clientId, reviewedAt: inRange }, select: { rating: true } }),
      db.seoAction.count({ where: { clientId, createdAt: inRange, status: { not: "ROLLED_BACK" } } }),
      db.aiGeneratedImage.count({ where: { clientId, createdAt: inRange } }),
      db.keyword.findMany({ where: { clientId }, select: { phrase: true, currentPosition: true, previousPosition: true } }),
      db.gbpMetric.aggregate({ where: { clientId, date: inRange }, _sum: { impressionsMaps: true, impressionsSearch: true, calls: true, websiteClicks: true, directionRequests: true } }),
      db.gbpMetric.aggregate({ where: { clientId, date: { gte: prevStart, lt: start } }, _sum: { impressionsMaps: true, impressionsSearch: true, calls: true, websiteClicks: true } }),
      db.gscMetric.aggregate({ where: { clientId, date: inRange }, _sum: { clicks: true, impressions: true } }),
      db.gscMetric.aggregate({ where: { clientId, date: { gte: prevStart, lt: start } }, _sum: { clicks: true, impressions: true } }),
      db.localGridRun.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 2 }),
      db.supportCall.count({ where: { clientId, occurredAt: inRange } }),
      db.supportTicket.count({ where: { clientId, resolvedAt: inRange } }),
      db.seoIssue.count({ where: { clientId, status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
      db.contentItem.findMany({ where: { clientId, scheduledFor: { gt: end }, status: { notIn: ["REJECTED"] } }, orderBy: { scheduledFor: "asc" }, take: 5, select: { title: true, type: true, scheduledFor: true } }),
      db.weeklyStrategy.findFirst({ where: { clientId }, orderBy: { weekOf: "desc" } }),
    ]);
    const maps = (gbpNow._sum.impressionsMaps ?? 0) + (gbpNow._sum.impressionsSearch ?? 0);
    const mapsPrev = (gbpPrev._sum.impressionsMaps ?? 0) + (gbpPrev._sum.impressionsSearch ?? 0);
    const pct = (a: number, b: number) => (b ? Math.round(((a - b) / b) * 100) : null);
    const ranked = keywords.filter((k) => k.currentPosition != null);
    const avgNow = ranked.length ? ranked.reduce((s, k) => s + k.currentPosition!, 0) / ranked.length : null;
    const withPrev = keywords.filter((k) => k.previousPosition != null);
    const avgPrev = withPrev.length ? withPrev.reduce((s, k) => s + k.previousPosition!, 0) / withPrev.length : null;
    const improved = keywords.filter((k) => k.currentPosition && k.previousPosition && k.currentPosition < k.previousPosition);
    const declined = keywords.filter((k) => k.currentPosition && k.previousPosition && k.currentPosition > k.previousPosition);
    const gridNow = grids[0];
    const gridPrev = grids[1];
    const data = {
      period: { start, end, days },
      done: { gbpPosts: posts, blogs, reviewReplies: reviewsReplied, seoImprovements: fixes, imagesGenerated: images, calls, ticketsResolved: tickets },
      gbp: { views: maps, viewsChange: pct(maps, mapsPrev), calls: gbpNow._sum.calls ?? 0, callsChange: pct(gbpNow._sum.calls ?? 0, gbpPrev._sum.calls ?? 0), websiteClicks: gbpNow._sum.websiteClicks ?? 0, directions: gbpNow._sum.directionRequests ?? 0 },
      search: { clicks: gscNow._sum.clicks ?? 0, clicksChange: pct(gscNow._sum.clicks ?? 0, gscPrev._sum.clicks ?? 0), impressions: gscNow._sum.impressions ?? 0 },
      rankings: { avgNow, avgPrev, improved: improved.map((k) => k.phrase), declined: declined.map((k) => k.phrase), tracked: keywords.length },
      grid: gridNow ? { keyword: gridNow.keyword, avg: gridNow.avgPosition, prevAvg: gridPrev?.avgPosition ?? null, top3: gridNow.top3Coverage, sov: gridNow.shareOfVoice } : null,
      reviews: { new: newReviews.length, avgRating: newReviews.length ? newReviews.reduce((s, r) => s + r.rating, 0) / newReviews.length : null },
      attention: { openHighIssues: openIssues },
      next: nextContent,
      strategy: strategy ? { summary: strategy.summary, priorities: strategy.priorities } : null,
    };
    const facts = [
      `${posts} Google Business Profile posts and ${blogs} blog articles were published.`,
      `${fixes} website and profile improvements were completed; ${reviewsReplied} reviews were replied to.`,
      data.gbp.viewsChange != null ? `Google profile views changed by ${data.gbp.viewsChange}% (${fmtNum(maps)} views).` : `Google profile views: ${fmtNum(maps)}.`,
      avgNow != null && avgPrev != null ? `Average keyword ranking moved from ${avgPrev.toFixed(1)} to ${avgNow.toFixed(1)}.` : "",
      gridNow && gridPrev ? `Google Maps average position moved from ${gridPrev.avgPosition?.toFixed(1)} to ${gridNow.avgPosition?.toFixed(1)}.` : "",
      improved.length ? `${improved.length} keywords improved; ${declined.length} declined.` : "",
      strategy ? `Next focus: ${(strategy.priorities as { title: string }[])[0]?.title ?? ""}.` : "",
    ].filter(Boolean);
    const summary = await generateReportSummary(client.name, facts, () => {
      const parts = [`${days === 7 ? "This week" : days >= 28 && days <= 31 ? "This month" : `In the last ${days} days`}, ${facts[0]!.charAt(0).toLowerCase()}${facts[0]!.slice(1)}`];
      if (data.gbp.viewsChange != null) parts.push(`Your Google profile was viewed ${fmtNum(maps)} times (${data.gbp.viewsChange >= 0 ? "up" : "down"} ${Math.abs(data.gbp.viewsChange)}%).`);
      if (avgNow != null && avgPrev != null) parts.push(`Your average search ranking ${avgNow <= avgPrev ? "improved" : "moved"} from ${avgPrev.toFixed(1)} to ${avgNow.toFixed(1)}.`);
      parts.push(`We completed ${fixes} improvements and replied to ${reviewsReplied} reviews.`);
      if (strategy) parts.push(`Your biggest opportunity next is: ${((strategy.priorities as { title: string }[])[0]?.title ?? "").toLowerCase()}.`);
      return parts.join(" ");
    });
    const ready = await db.report.update({ where: { id: report.id }, data: { status: "READY", summary: summary.data, data: data as unknown as Prisma.InputJsonValue } });
    await activity({ organizationId: client.organizationId, clientId, category: "SYSTEM", type: "report.generated", title: `${TITLES[type]} generated`, actor: SYSTEM_ACTOR });
    const recipients = client.automation?.reportRecipients.length ? client.automation.reportRecipients : client.contacts.filter((c) => c.receivesReports && c.email).map((c) => c.email!);
    if ((opts.send ?? client.automation?.reportAutoEmail) && recipients.length) {
      const brand = ready.whiteLabel ? client.organization.whiteLabelName ?? client.organization.name : BRAND.name;
      await sendEmail({ to: recipients, subject: `${TITLES[type]} — ${client.name}`, text: `${summary.data}\n\nView the full report: ${env.appUrl}/portal/reports/${ready.id}\n\n— ${brand}` });
      await db.report.update({ where: { id: ready.id }, data: { status: "SENT", sentAt: new Date(), sentTo: recipients } });
    }
    return ready;
  } catch (e) {
    await db.report.update({ where: { id: report.id }, data: { status: "FAILED", summary: (e as Error).message } });
    throw e;
  }
}
