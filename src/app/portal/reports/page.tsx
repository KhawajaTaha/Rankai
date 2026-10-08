import Link from "next/link";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader, fmtDate } from "@/components/ui";
import { pretty } from "@/lib/labels";
import { ReportDownloadForm, ReportFileLinks } from "@/components/report-download";

export const metadata = { title: "Reports" };

export default async function PortalReports() {
  const ctx = await requirePortal();
  const reports = await db.report.findMany({ where: { clientId: ctx.portalClientId, clientVisible: true, status: { in: ["READY", "SENT"] } }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Reports" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card pad={false} className="lg:col-span-2">
          <ul className="divide-y divide-ink-100">
            {reports.map((r) => (
              <li key={r.id} className="flex items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1"><Link href={`/portal/reports/${r.id}`} className="text-sm font-medium hover:text-brand-700">{pretty(r.type)}</Link><div className="text-xs text-ink-500">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</div></div>
                <ReportFileLinks reportId={r.id} compact />
              </li>
            ))}
          </ul>
          {!reports.length && <EmptyState title="Your first report is on its way" />}
        </Card>
        <Card title="Download report" subtitle="Last 30 days or any period you choose">
          <ReportDownloadForm />
        </Card>
      </div>
    </>
  );
}
