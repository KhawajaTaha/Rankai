import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { attentionSummary, automationWins } from "@/lib/queries";
import { HANDLERS } from "@/lib/jobs/handlers";
import { addDays, fmtNum } from "@/lib/utils";
import { Card, PageHeader, Stat, StatusBadge, Tabs, timeAgo } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { runSchedulerNowAction } from "@/app/actions/ops";

export const metadata = { title: "Automation Command Center" };

export default async function CommandCenter() {
  const ctx = await requireStaff();
  if (!ctx.can("view_command_center")) redirect("/dashboard");
  const scope = await clientScopeFilter(ctx);
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [running, scheduled, failed, att, disconnected, contentDue, auditsDue, reportsDue, recent, wins, byType] = await Promise.all([
    db.automationRun.count({ where: { ...scope, status: "RUNNING" } }),
    db.automationRun.count({ where: { ...scope, status: { in: ["QUEUED", "RETRYING"] } } }),
    db.automationRun.count({ where: { ...scope, status: { in: ["FAILED", "NEEDS_HUMAN"] }, createdAt: { gte: addDays(now, -14) } } }),
    attentionSummary(ctx),
    db.googleConnection.count({ where: { organizationId: ctx.orgId, status: { not: "CONNECTED" } } }),
    db.contentItem.count({ where: { ...scope, status: { in: ["IDEA", "NEEDS_APPROVAL", "SCHEDULED"] }, scheduledFor: { lte: addDays(now, 7) } } }),
    db.automationRun.count({ where: { ...scope, type: { in: ["website.crawl", "gbp.audit"] }, status: { in: ["QUEUED", "RETRYING"] } } }),
    db.automationRun.count({ where: { ...scope, type: "report.generate", status: { in: ["QUEUED", "RETRYING"] } } }),
    db.automationRun.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 12, include: { } }),
    automationWins(ctx.orgId, monthStart, scope.clientId?.in ?? null),
    db.automationRun.groupBy({ by: ["type", "status"], where: { ...scope, createdAt: { gte: addDays(now, -7) } }, _count: true }),
  ]);
  const types = [...new Set(byType.map((b) => b.type))];
  return (
    <>
      <PageHeader title="Automation Command Center" subtitle="The control room — everything the platform is doing, scheduled, or stuck on" actions={ctx.can("manage_automations") && <ActionButton action={runSchedulerNowAction} className="btn-secondary">Run scheduler & watchdog now</ActionButton>} />
      <Tabs active="/automations" tabs={[{ href: "/automations", label: "Overview" }, { href: "/automations/history", label: "Execution History" }]} />
      <div className="mt-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Stat label="Jobs running" value={running} />
        <Stat label="Jobs scheduled" value={scheduled} href="/automations/history?status=queued" />
        <Stat label="Jobs failed (14d)" value={failed} tone={failed ? "red" : "green"} href="/automations/history?status=failed" />
        <Stat label="Approvals waiting" value={att.approvals} href="/approvals" tone={att.approvals ? "amber" : undefined} />
        <Stat label="Disconnected integrations" value={disconnected + att.brokenGoogle} tone={disconnected + att.brokenGoogle ? "red" : "green"} href="/integrations" />
        <Stat label="Content due (7d)" value={contentDue} href="/content" />
        <Stat label="Audits queued" value={auditsDue} />
        <Stat label="Reports queued" value={reportsDue} href="/reports" />
        <Stat label="Open alerts" value={att.criticalAlerts} tone={att.criticalAlerts ? "red" : "green"} href="/alerts" />
      </div>
      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        <Card title="This month AI completed" subtitle="Automation success / platform ROI" className="lg:col-span-1">
          <ul className="space-y-2 text-sm">
            {[["GBP Posts", wins.posts], ["Images Generated", wins.images], ["Reviews Replied", wins.replies], ["Blogs Generated", wins.blogs], ["SEO Issues Fixed", wins.fixes], ["Internal Links Added", wins.links], ["Reports Generated", wins.reports]].map(([l, v]) => <li key={l as string} className="flex justify-between"><span className="text-ink-600">{l}</span><span className="font-semibold">{fmtNum(v as number)}</span></li>)}
          </ul>
        </Card>
        <Card title="Last 7 days by automation" className="lg:col-span-2" pad={false}>
          <table className="w-full"><thead className="bg-ink-50/60"><tr>{["Automation", "Succeeded", "Retrying", "Failed / needs human", "Queued"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{types.map((t) => {
              const c = (s: string[]) => byType.filter((b) => b.type === t && s.includes(b.status)).reduce((x, b) => x + b._count, 0);
              return <tr key={t} className="tr text-sm"><td className="td">{HANDLERS[t]?.label ?? t}</td><td className="td text-emerald-700">{c(["SUCCEEDED"])}</td><td className="td">{c(["RETRYING"])}</td><td className={`td ${c(["FAILED", "NEEDS_HUMAN"]) ? "font-medium text-red-600" : ""}`}>{c(["FAILED", "NEEDS_HUMAN"])}</td><td className="td">{c(["QUEUED"])}</td></tr>;
            })}</tbody>
          </table>
        </Card>
      </div>
      <Card title="Latest activity" className="mt-5" pad={false} actions={<Link href="/automations/history" className="link text-xs">Full history</Link>}>
        <ul className="divide-y divide-ink-100">{recent.map((r) => <li key={r.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><span className="flex-1 truncate">{r.label ?? HANDLERS[r.type]?.label ?? r.type}</span><StatusBadge status={r.status} /><span className="w-20 text-right text-xs text-ink-400">{timeAgo(r.createdAt)}</span></li>)}</ul>
      </Card>
    </>
  );
}
