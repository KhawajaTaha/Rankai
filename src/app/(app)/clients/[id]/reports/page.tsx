import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { Card, EmptyState, StatusBadge, fmtDate } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { generateReportAction } from "@/app/actions/ops";
import { pretty } from "@/lib/labels";
import { ReportDownloadForm, ReportFileLinks } from "@/components/report-download";

export default async function ClientReports({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  await getAccessibleClient(ctx, id);
  const [reports, s] = await Promise.all([db.report.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" } }), db.automationSetting.findUnique({ where: { clientId: id } })]);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Reports" className="lg:col-span-2" pad={false}>
        <ul className="divide-y divide-ink-100">
          {reports.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-5 py-3">
              <div className="min-w-0 flex-1">
                <Link href={`/reports/${r.id}`} className="text-sm font-medium hover:text-brand-700">{r.title}</Link>
                <div className="text-xs text-ink-500">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)} · {r.sentTo.length ? `sent to ${r.sentTo.join(", ")}` : r.clientVisible ? "in client portal" : "internal"}</div>
              </div>
              {(r.status === "READY" || r.status === "SENT") && <ReportFileLinks reportId={r.id} compact />}
              <StatusBadge status={r.status} />
            </li>
          ))}
        </ul>
        {!reports.length && <EmptyState title="No reports yet" />}
      </Card>
      <div className="space-y-5">
        <Card title="Download report" subtitle="Last 30 days or any period you choose">
          <ReportDownloadForm clientId={id} />
        </Card>
        {ctx.can("generate_reports") && (
          <Card title="Generate report">
            <ActionForm action={generateReportAction} className="space-y-3">
              <input type="hidden" name="clientId" value={id} />
              <Field label="Type"><select name="type" className="input">{["MONTHLY_SEO", "WEEKLY_SUMMARY", "GBP", "WEBSITE_SEO", "RANKING", "CONTENT", "SUPPORT", "EXECUTIVE"].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</select></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send" className="h-4 w-4 rounded" /> Email to report recipients</label>
              <SubmitButton>Generate</SubmitButton>
            </ActionForm>
          </Card>
        )}
        <Card title="Automatic delivery" actions={<Link href={`/clients/${id}/automations`} className="link text-xs">Edit</Link>}>
          <ul className="space-y-1 text-sm text-ink-700">
            <li>Weekly report: {s?.weeklyReport ? "On" : "Off"}</li>
            <li>Monthly report: {s?.monthlyReport ? "On" : "Off"} (day {s?.reportDay})</li>
            <li>Auto email: {s?.reportAutoEmail ? "On" : "Portal only"}</li>
            <li>Recipients: {s?.reportRecipients.join(", ") || "—"}</li>
            <li>White label: {s?.reportWhiteLabel ? "Yes" : "No"}</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
