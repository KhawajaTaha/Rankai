import type { AutomationRun } from "@prisma/client";
import { db } from "../db";
import { AUTOMATION_ACTOR } from "../audit";
import { executeRecommendation } from "../engine/executor";
import { generateContent, generateDueContent, planCalendar, publishContent } from "../services/content";
import { auditGbp, syncConnectionLocations, syncLocation } from "../services/gbp";
import { postReviewReply, processNewReview } from "../services/reviews";
import { crawlAndAudit, monitorWebsite, syncGa4, syncSearchConsole } from "../services/website";
import { analyzeCompetitors, checkClientRanks, runClientGrid } from "../services/rankings";
import { measureAction, weeklyStrategy } from "../services/strategy";
import { generateReport } from "../services/reports";
import { scanClients, updateHealth } from "../services/watchdog";
import { processFollowUps } from "../services/support";
import { archiveClient } from "../services/offboarding";
import { refreshOnboarding } from "../services/onboarding";
import { generateAiImage } from "../images/generate";
import { runScheduler } from "./scheduler";

type Handler = (payload: Record<string, unknown>, run: AutomationRun) => Promise<unknown>;

const s = (v: unknown) => String(v);

/** Registry of every background job type (spec §84). */
export const HANDLERS: Record<string, { label: string; handler: Handler }> = {
  "scheduler.tick": { label: "Scheduler tick", handler: () => runScheduler() },
  "gbp.sync_connection": { label: "GBP connection sync", handler: (p) => syncConnectionLocations(s(p.connectionId)) },
  "gbp.sync": { label: "GBP sync", handler: async (p, run) => {
    if (p.locationId) return syncLocation(s(p.locationId));
    const locs = await db.gbpLocation.findMany({ where: { clientId: run.clientId! } });
    const out = [];
    for (const l of locs) out.push(await syncLocation(l.id));
    return out;
  } },
  "gbp.audit": { label: "GBP audit", handler: (p, run) => auditGbp(s(p.clientId ?? run.clientId), run.id) },
  "reviews.process": { label: "Review response", handler: (p) => processNewReview(s(p.reviewId)) },
  "reviews.post_reply": { label: "Post review reply", handler: (p) => postReviewReply(s(p.reviewId), AUTOMATION_ACTOR) },
  "content.plan": { label: "Content calendar planning", handler: (p, run) => planCalendar(s(p.clientId ?? run.clientId), Number(p.weeks ?? 4)) },
  "content.generate_due": { label: "Generate upcoming content", handler: (p, run) => generateDueContent(s(p.clientId ?? run.clientId)) },
  "content.generate": { label: "Content generation", handler: (p) => generateContent(s(p.contentItemId)) },
  "content.publish": { label: "Content publishing", handler: (p) => publishContent(s(p.contentItemId)) },
  "image.generate": { label: "AI image generation", handler: (p, run) => generateAiImage({ organizationId: run.organizationId, clientId: s(p.clientId ?? run.clientId), purpose: (p.purpose as "GBP_POST") ?? "GBP_POST", concept: s(p.concept), mode: "REQUIRE_APPROVAL" }) },
  "website.crawl": { label: "Website crawl & audit", handler: (p, run) => crawlAndAudit(s(p.clientId ?? run.clientId)) },
  "website.monitor": { label: "Website monitoring", handler: (p, run) => monitorWebsite(s(p.clientId ?? run.clientId)) },
  "gsc.sync": { label: "Search Console sync", handler: (p, run) => syncSearchConsole(s(p.clientId ?? run.clientId)) },
  "ga4.sync": { label: "GA4 sync", handler: (p, run) => syncGa4(s(p.clientId ?? run.clientId)) },
  "ranks.check": { label: "Ranking check", handler: (p, run) => checkClientRanks(s(p.clientId ?? run.clientId)) },
  "grid.check": { label: "Local grid check", handler: (p, run) => runClientGrid(s(p.clientId ?? run.clientId), p.keyword as string | undefined) },
  "competitors.analyze": { label: "Competitor analysis", handler: (p, run) => analyzeCompetitors(s(p.clientId ?? run.clientId)) },
  "strategy.weekly": { label: "Weekly AI strategy", handler: (p, run) => weeklyStrategy(s(p.clientId ?? run.clientId)) },
  "recommendation.execute": { label: "Execute recommendation", handler: (p, run) => executeRecommendation(s(p.recommendationId), AUTOMATION_ACTOR, run.id) },
  "feedback.measure": { label: "Measure impact", handler: (p) => measureAction(s(p.seoActionId)) },
  "report.generate": { label: "Report generation", handler: (p, run) => generateReport(s(p.clientId ?? run.clientId), (p.type as "MONTHLY_SEO") ?? "MONTHLY_SEO", { send: p.send as boolean | undefined }).then((r) => ({ reportId: r.id })) },
  "support.reminders": { label: "Support reminders", handler: (_p, run) => processFollowUps(run.organizationId) },
  "watchdog.scan": { label: "Watchdog scan", handler: async (_p, run) => (await scanClients(run.organizationId, { act: true })).length },
  "health.update": { label: "Health score update", handler: (p, run) => updateHealth(s(p.clientId ?? run.clientId)) },
  "onboarding.refresh": { label: "Onboarding refresh", handler: (p, run) => refreshOnboarding(s(p.clientId ?? run.clientId)) },
  "client.archive": { label: "Archive client", handler: (p, run) => archiveClient(s(p.clientId ?? run.clientId)) },
};
