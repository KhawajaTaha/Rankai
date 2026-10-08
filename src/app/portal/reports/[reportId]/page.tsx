import { notFound } from "next/navigation";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { ReportView } from "@/components/report-view";
import { PrintButton } from "@/components/print-button";
import { ReportFileLinks } from "@/components/report-download";
import { BRAND } from "@/lib/brand";

export default async function PortalReport({ params }: { params: Promise<{ reportId: string }> }) {
  const ctx = await requirePortal();
  const { reportId } = await params;
  const report = await db.report.findFirst({ where: { id: reportId, clientId: ctx.portalClientId, clientVisible: true }, include: { client: true } });
  if (!report) notFound();
  return (
    <div>
      <div className="mb-4 flex justify-end gap-2 print:hidden">{report.status !== "GENERATING" && report.status !== "FAILED" && <ReportFileLinks reportId={report.id} />}<PrintButton /></div>
      <ReportView report={report} clientName={report.client.name} brand={report.whiteLabel ? ctx.org.whiteLabelName ?? ctx.org.name : BRAND.name} />
    </div>
  );
}
