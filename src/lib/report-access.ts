import type { Ctx } from "./auth";
import { BRAND } from "./brand";
import { db } from "./db";
import { accessibleClientIds } from "./tenancy";
import { reportCsv, reportPdf } from "./report-export";
import type { Report } from "@prisma/client";

/** Can this user read reports for this client? Portal users: own client only. Staff: view_reports + assignment. */
export async function canReadClientReports(ctx: Ctx, clientId: string) {
  if (!ctx.can("view_reports")) return false;
  const ids = await accessibleClientIds(ctx);
  if (ids && !ids.includes(clientId)) return false;
  return !!(await db.client.findFirst({ where: { id: clientId, organizationId: ctx.orgId }, select: { id: true } }));
}

const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "").toLowerCase().slice(0, 80) || "report";

/** Build the file response (PDF or CSV) for a report. */
export async function reportFileResponse(ctx: Ctx, report: Report & { client: { name: string } }, format: string) {
  const brand = report.whiteLabel ? ctx.org.whiteLabelName ?? ctx.org.name : BRAND.name;
  const base = `${safeName(report.client.name)}-${report.type.toLowerCase().replace(/_/g, "-")}-${report.periodStart.toISOString().slice(0, 10)}-to-${report.periodEnd.toISOString().slice(0, 10)}`;
  const headers = { "cache-control": "private, no-store", "x-content-type-options": "nosniff" };
  if (format === "csv") {
    const csv = await reportCsv(report, report.client.name);
    return new Response(csv, { headers: { ...headers, "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${base}.csv"` } });
  }
  const pdf = await reportPdf(report, report.client.name, brand);
  return new Response(new Uint8Array(pdf), { headers: { ...headers, "content-type": "application/pdf", "content-disposition": `attachment; filename="${base}.pdf"` } });
}
