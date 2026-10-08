import { NextResponse, type NextRequest } from "next/server";
import type { ReportType } from "@prisma/client";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { generateReport } from "@/lib/services/reports";
import { resolveRange } from "@/lib/report-export";
import { canReadClientReports, reportFileResponse } from "@/lib/report-access";

export const maxDuration = 120;

const TYPES: ReportType[] = ["MONTHLY_SEO", "WEEKLY_SUMMARY", "GBP", "WEBSITE_SEO", "RANKING", "CONTENT", "SUPPORT", "EXECUTIVE"];

/**
 * Build a report for a chosen period ("last 30 days", "last month", custom from/to) and download it.
 * POST (form submit) because it creates a report record; the Origin header must match this app.
 */
export async function POST(req: NextRequest) {
  const origin = req.headers.get("origin");
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  if (origin && host && new URL(origin).host !== host && origin !== new URL(env.appUrl).origin) return new NextResponse("Forbidden", { status: 403 });
  const ctx = await getCtx();
  if (!ctx) return new NextResponse("Unauthorized", { status: 401 });
  const f = await req.formData();
  const clientId = ctx.isClientUser ? ctx.portalClientId ?? "" : String(f.get("clientId") ?? "");
  if (!clientId || !(await canReadClientReports(ctx, clientId))) return new NextResponse("Not found", { status: 404 });
  const type = (TYPES.includes(String(f.get("type")) as ReportType) ? String(f.get("type")) : "MONTHLY_SEO") as ReportType;
  let range;
  try {
    range = resolveRange(String(f.get("preset") ?? "30d"), f.get("from") as string | null, f.get("to") as string | null);
  } catch (e) {
    return new NextResponse((e as Error).message, { status: 400 });
  }
  const created = await generateReport(clientId, type, { createdById: ctx.isClientUser ? null : ctx.memberId, send: false, start: range.start, end: range.end });
  const report = await db.report.findUniqueOrThrow({ where: { id: created.id }, include: { client: { select: { name: true } } } });
  return reportFileResponse(ctx, report, String(f.get("format") ?? "pdf"));
}
