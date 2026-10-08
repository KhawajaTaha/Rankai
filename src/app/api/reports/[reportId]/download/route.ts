import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { canReadClientReports, reportFileResponse } from "@/lib/report-access";

/** Download an existing report as PDF (default) or CSV. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ reportId: string }> }) {
  const { reportId } = await params;
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("Not found", { status: 404 });
  const report = await db.report.findFirst({ where: { id: reportId, organizationId: ctx.orgId, status: { in: ["READY", "SENT"] } }, include: { client: { select: { name: true } } } });
  if (!report || !(await canReadClientReports(ctx, report.clientId))) return new NextResponse("Not found", { status: 404 });
  if (ctx.isClientUser && !report.clientVisible) return new NextResponse("Not found", { status: 404 });
  return reportFileResponse(ctx, report, req.nextUrl.searchParams.get("format") ?? "pdf");
}
