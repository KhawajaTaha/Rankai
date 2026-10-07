import Link from "next/link";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays, fmtNum } from "@/lib/utils";
import { Card, LineChart, PageHeader, ScoreRing, Stat, timeAgo } from "@/components/ui";

export const metadata = { title: "Overview" };

export default async function PortalHome() {
  const ctx = await requirePortal();
  const id = ctx.portalClientId;
  const since = addDays(new Date(), -30);
  const prev = addDays(new Date(), -60);
  const [client, approvals, m, mp, series, recent, report, nextUp] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id } }),
    db.approval.count({ where: { clientId: id, status: "PENDING", requiresClient: true } }),
    db.gbpMetric.aggregate({ where: { clientId: id, date: { gte: since } }, _sum: { impressionsMaps: true, impressionsSearch: true, calls: true, websiteClicks: true, directionRequests: true } }),
    db.gbpMetric.aggregate({ where: { clientId: id, date: { gte: prev, lt: since } }, _sum: { impressionsMaps: true, impressionsSearch: true, calls: true } }),
    db.gbpMetric.findMany({ where: { clientId: id, date: { gte: addDays(new Date(), -60) } }, orderBy: { date: "asc" } }),
    db.activityLog.findMany({ where: { clientId: id, category: { in: ["GBP", "CONTENT", "WEBSITE", "SEO"] } }, orderBy: { createdAt: "desc" }, take: 8 }),
    db.report.findFirst({ where: { clientId: id, clientVisible: true, status: { in: ["READY", "SENT"] } }, orderBy: { createdAt: "desc" } }),
    db.contentItem.findMany({ where: { clientId: id, scheduledFor: { gte: new Date() }, status: { in: ["SCHEDULED", "NEEDS_APPROVAL"] } }, orderBy: { scheduledFor: "asc" }, take: 4 }),
  ]);
  const views = (m._sum.impressionsMaps ?? 0) + (m._sum.impressionsSearch ?? 0);
  const pviews = (mp._sum.impressionsMaps ?? 0) + (mp._sum.impressionsSearch ?? 0);
  const pct = (a: number, b: number) => (b ? ((a - b) / b) * 100 : null);
  return (
    <>
      <PageHeader title={`Welcome, ${ctx.user.name.split(" ")[0]}`} subtitle={`Here's how ${client.name} is doing online`} />
      {approvals > 0 && ctx.can("portal_approve") && (
        <Link href="/portal/approvals" className="card mb-5 flex items-center gap-3 border-amber-200 bg-amber-50 p-4 hover:border-amber-300">
          <CheckCircle2 className="h-5 w-5 text-amber-600" />
          <span className="flex-1 text-sm font-medium text-amber-900">{approvals} item{approvals > 1 ? "s" : ""} need{approvals === 1 ? "s" : ""} your approval</span>
          <span className="btn-primary btn-sm">Review <ArrowRight className="h-3.5 w-3.5" /></span>
        </Link>
      )}
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="People who found you on Google (30d)" value={fmtNum(views)} delta={pct(views, pviews)} />
        <Stat label="Calls from Google" value={fmtNum(m._sum.calls ?? 0)} delta={pct(m._sum.calls ?? 0, mp._sum.calls ?? 0)} />
        <Stat label="Website visits from Google" value={fmtNum(m._sum.websiteClicks ?? 0)} />
        <Stat label="Direction requests" value={fmtNum(m._sum.directionRequests ?? 0)} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Your Google visibility" className="lg:col-span-2"><LineChart series={[{ name: "Views", values: series.map((s) => s.impressionsMaps + s.impressionsSearch) }]} labels={series.map((s) => s.date.toISOString().slice(5, 10))} /></Card>
        <Card title="Your scores">
          <div className="flex justify-around"><div className="text-center"><ScoreRing score={client.gbpScore} size={64} /><div className="mt-1 text-xs text-ink-500">Google profile</div></div><div className="text-center"><ScoreRing score={client.seoScore} size={64} /><div className="mt-1 text-xs text-ink-500">Website</div></div></div>
          {report && <Link href={`/portal/reports/${report.id}`} className="btn-secondary mt-5 w-full">Latest report</Link>}
        </Card>
        <Card title="What we did recently" className="lg:col-span-2" pad={false}>
          <ul className="divide-y divide-ink-100">{recent.map((a) => <li key={a.id} className="px-5 py-2.5 text-sm">{a.title}<div className="text-xs text-ink-400">{timeAgo(a.createdAt)}</div></li>)}</ul>
        </Card>
        <Card title="Coming up" pad={false}>
          <ul className="divide-y divide-ink-100">{nextUp.map((c) => <li key={c.id} className="px-5 py-2.5 text-sm">{c.title}<div className="text-xs text-ink-400">{c.type === "BLOG" ? "Article" : "Google post"} · {c.scheduledFor?.toLocaleDateString("en-CA", { month: "short", day: "numeric" })}</div></li>)}</ul>
        </Card>
      </div>
    </>
  );
}
