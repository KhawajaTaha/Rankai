import { db } from "../db";
import { addDays, isoDate } from "../utils";
import { enqueue } from "./queue";

/**
 * Scheduling engine (spec §84, §99-101). Runs every few minutes; uses dedupe keys per
 * (job, client, period) so each daily / weekly / monthly flow runs exactly once.
 */
export async function runScheduler(now = new Date()) {
  const day = isoDate(now);
  const weekKey = `${now.getUTCFullYear()}-W${isoWeek(now)}`;
  const monthKey = day.slice(0, 7);
  const orgs = await db.organization.findMany({ select: { id: true } });
  let enqueued = 0;
  const q = async (type: string, orgId: string, clientId: string | null, period: string, label: string, payload: Record<string, unknown> = {}, runAt?: Date) => {
    const r = await enqueue(type, { ...(clientId ? { clientId } : {}), ...payload }, { organizationId: orgId, clientId, label, dedupeKey: `${period}:${type}:${clientId ?? orgId}`, runAt });
    if (r.createdAt.getTime() >= now.getTime() - 1000) enqueued++;
  };
  for (const org of orgs) {
    // Agency-level daily jobs
    await q("support.reminders", org.id, null, `${day}:h${now.getUTCHours()}`, "Follow-up reminders & escalations");
    await q("watchdog.scan", org.id, null, day, "No-work-forgotten watchdog");

    const clients = await db.client.findMany({
      where: { organizationId: org.id, archivedAt: null, status: { in: ["ACTIVE", "ONBOARDING"] } },
      include: { automation: true, locations: { select: { id: true } }, websites: { select: { id: true } }, integrations: { select: { kind: true, status: true } }, competitors: { select: { id: true }, take: 1 } },
    });
    for (const c of clients) {
      const s = c.automation;
      const paused = c.automationPaused;
      const hasGbp = c.locations.length > 0;
      const hasSite = c.websites.length > 0;
      const connected = (k: string) => c.integrations.some((i) => i.kind === k && i.status === "CONNECTED");

      // ── Daily (spec §99) ──
      if (hasGbp) await q("gbp.sync", org.id, c.id, day, "Daily GBP sync (connection, reviews, posts)");
      if (hasSite) await q("website.monitor", org.id, c.id, day, "Daily website health check");
      await q("health.update", org.id, c.id, day, "Health score update");
      if (!paused && s && hasGbp && s.gbpPostingEnabled) await q("content.generate_due", org.id, c.id, day, "Generate upcoming content");

      // ── Weekly (spec §100) ──
      if (!paused) {
        if (s?.rankTracking === "DAILY") await q("ranks.check", org.id, c.id, day, "Daily ranking check");
        else if (s?.rankTracking !== "OFF") await q("ranks.check", org.id, c.id, weekKey, "Weekly ranking check");
        if (s?.mapGrid === "WEEKLY") await q("grid.check", org.id, c.id, weekKey, "Weekly local grid");
        if (s?.mapGrid === "MONTHLY") await q("grid.check", org.id, c.id, monthKey, "Monthly local grid");
        if (connected("GOOGLE_SEARCH_CONSOLE")) await q("gsc.sync", org.id, c.id, weekKey, "Search Console sync & opportunities");
        if (connected("GOOGLE_ANALYTICS_4")) await q("ga4.sync", org.id, c.id, weekKey, "GA4 sync");
        if (hasGbp && s?.gbpPostingEnabled) await q("content.plan", org.id, c.id, weekKey, "Plan content calendar");
        if (c.competitors.length) await q("competitors.analyze", org.id, c.id, weekKey, "Competitor review");
        await q("strategy.weekly", org.id, c.id, weekKey, "Weekly AI SEO strategy", {}, addDays(now, 0));
        if (s?.weeklyReport && now.getDay() === (s.reportDay ?? 1)) await q("report.generate", org.id, c.id, weekKey, "Weekly report", { type: "WEEKLY_SUMMARY" });
      }

      // ── Monthly (spec §101) ──
      if (!paused) {
        if (hasGbp) await q("gbp.audit", org.id, c.id, monthKey, "Monthly GBP audit");
        if (hasSite) await q("website.crawl", org.id, c.id, monthKey, "Monthly full website audit");
        if (s?.monthlyReport && now.getDate() >= Math.min(28, Math.max(1, s.reportDay ?? 1))) await q("report.generate", org.id, c.id, monthKey, "Monthly SEO report", { type: "MONTHLY_SEO" });
      }
    }
  }
  return { enqueued };
}

function isoWeek(d: Date) {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNum = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return String(Math.ceil(((t.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7)).padStart(2, "0");
}
