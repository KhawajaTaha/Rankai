import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { Card, EmptyState, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { generateReportAction } from "@/app/actions/ops";
import { pretty } from "@/lib/labels";

export const metadata = { title: "Reports" };

export default async function ReportsPage() {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const [reports, clients] = await Promise.all([
    db.report.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 100, include: { client: { select: { name: true } } } }),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Reports" subtitle="Generated automatically on each client's schedule — no manual report prep" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Recent reports" className="lg:col-span-2" pad={false}>
          <table className="w-full">
            <thead className="bg-ink-50/60"><tr>{["Report", "Client", "Period", "Delivery", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id} className="tr">
                  <td className="td"><Link href={`/reports/${r.id}`} className="font-medium hover:text-brand-700">{pretty(r.type)}</Link></td>
                  <td className="td">{r.client.name}</td>
                  <td className="td text-xs">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                  <td className="td text-xs">{r.sentAt ? `Emailed ${fmtDate(r.sentAt)}` : "Portal"}</td>
                  <td className="td"><StatusBadge status={r.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!reports.length && <EmptyState title="No reports yet" />}
        </Card>
        {ctx.can("generate_reports") && (
          <Card title="Generate a report">
            <ActionForm action={generateReportAction} className="space-y-3">
              <Field label="Client"><select name="clientId" className="input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
              <Field label="Type"><select name="type" className="input">{["MONTHLY_SEO", "WEEKLY_SUMMARY", "GBP", "WEBSITE_SEO", "RANKING", "CONTENT", "SUPPORT", "EXECUTIVE"].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</select></Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="send" className="h-4 w-4 rounded" /> Email to recipients</label>
              <SubmitButton>Generate</SubmitButton>
              <p className="text-xs text-ink-500">For many clients at once use Clients → Bulk → Generate reports.</p>
            </ActionForm>
          </Card>
        )}
      </div>
    </>
  );
}
