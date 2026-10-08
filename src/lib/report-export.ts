import fs from "node:fs/promises";
import path from "node:path";
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from "pdf-lib";
import type { Report } from "@prisma/client";
import { db } from "./db";
import { BRAND } from "./brand";
import { addDays } from "./utils";

export type RangePreset = "7d" | "30d" | "90d" | "this_month" | "last_month" | "custom";

/** Resolve a date-range filter ("last 30 days", "last month", custom from/to). */
export function resolveRange(preset: string | null, from?: string | null, to?: string | null): { start: Date; end: Date; label: string } {
  const now = new Date();
  switch (preset) {
    case "7d": return { start: addDays(now, -7), end: now, label: "Last 7 days" };
    case "90d": return { start: addDays(now, -90), end: now, label: "Last 90 days" };
    case "this_month": return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)), end: now, label: "This month" };
    case "last_month": return { start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)), end: new Date(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).getTime() - 1), label: "Last month" };
    case "custom": {
      const s = from ? new Date(`${from}T00:00:00Z`) : null;
      const e = to ? new Date(addDays(new Date(`${to}T00:00:00Z`), 1).getTime() - 1) : null; // inclusive end date (23:59:59.999)
      if (!s || !e || Number.isNaN(s.getTime()) || Number.isNaN(e.getTime()) || s >= e) throw new Error("Choose a valid From and To date");
      if (e.getTime() - s.getTime() > 400 * 86_400_000) throw new Error("Maximum range is 400 days");
      return { start: s, end: e > now ? now : e, label: `${from} to ${to}` };
    }
    default: return { start: addDays(now, -30), end: now, label: "Last 30 days" };
  }
}

type Data = {
  done: Record<string, number>;
  gbp: { views: number; viewsChange: number | null; calls: number; callsChange: number | null; websiteClicks: number; directions: number };
  search: { clicks: number; clicksChange: number | null; impressions: number };
  rankings: { avgNow: number | null; avgPrev: number | null; improved: string[]; declined: string[]; tracked: number };
  grid: { keyword: string; avg: number | null; prevAvg: number | null; top3: number | null; sov: number | null } | null;
  reviews: { new: number; avgRating: number | null };
  attention: { openHighIssues: number };
  next: { title: string; type: string; scheduledFor: string }[];
  strategy: { summary: string; priorities: { title: string }[] } | null;
};

const DONE_LABELS: Record<string, string> = { gbpPosts: "Google posts published", blogs: "Articles published", reviewReplies: "Reviews replied to", seoImprovements: "SEO improvements", imagesGenerated: "Images created", calls: "Support calls", ticketsResolved: "Requests resolved" };

/** Daily series + keyword table used by both PDF and CSV exports. */
async function detail(report: Report) {
  const range = { gte: report.periodStart, lte: report.periodEnd };
  const [daily, keywords] = await Promise.all([
    db.gbpMetric.groupBy({ by: ["date"], where: { clientId: report.clientId, date: range }, _sum: { impressionsMaps: true, impressionsSearch: true, calls: true, websiteClicks: true, directionRequests: true }, orderBy: { date: "asc" } }),
    db.keyword.findMany({ where: { clientId: report.clientId }, orderBy: { phrase: "asc" }, select: { phrase: true, currentPosition: true, previousPosition: true, bestPosition: true, localPosition: true } }),
  ]);
  return { daily, keywords };
}

// WinAnsi-safe text for the standard PDF fonts.
const clean = (s: unknown) =>
  String(s ?? "")
    .replace(/[—–]/g, "-")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/★/g, " stars")
    .replace(/→/g, "->")
    .replace(/…/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "");

export async function reportPdf(report: Report, clientName: string, brandName: string): Promise<Uint8Array> {
  const d = report.data as unknown as Data | null;
  const { daily, keywords } = await detail(report);
  const pdf = await PDFDocument.create();
  pdf.setTitle(clean(report.title));
  pdf.setAuthor(clean(brandName));
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const NAVY = rgb(0.1, 0.25, 0.56);
  const ORANGE = rgb(0.96, 0.48, 0.13);
  const GREY = rgb(0.4, 0.43, 0.5);
  const W = 595.28;
  const H = 841.89;
  const M = 48;
  let page: PDFPage = pdf.addPage([W, H]);
  let y = H - M;

  const newPage = () => {
    page = pdf.addPage([W, H]);
    y = H - M;
  };
  const ensure = (h: number) => {
    if (y - h < M) newPage();
  };
  const wrap = (text: string, f: PDFFont, size: number, width: number) => {
    const words = clean(text).split(/\s+/);
    const lines: string[] = [];
    let line = "";
    for (const w of words) {
      const t = line ? `${line} ${w}` : w;
      if (f.widthOfTextAtSize(t, size) > width && line) {
        lines.push(line);
        line = w;
      } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  };
  const para = (text: string, size = 10, f = font, color = rgb(0.13, 0.15, 0.2)) => {
    for (const l of wrap(text, f, size, W - 2 * M)) {
      ensure(size + 4);
      page.drawText(l, { x: M, y, size, font: f, color });
      y -= size + 4;
    }
  };
  const heading = (text: string) => {
    ensure(34);
    y -= 10;
    page.drawRectangle({ x: M, y: y - 3, width: 3, height: 14, color: ORANGE });
    page.drawText(clean(text), { x: M + 9, y, size: 12.5, font: bold, color: NAVY });
    y -= 20;
  };
  const table = (head: string[], rows: (string | number)[][], widths: number[]) => {
    const rowH = 15;
    const drawRow = (cells: (string | number)[], f: PDFFont, shade: boolean) => {
      ensure(rowH);
      if (shade) page.drawRectangle({ x: M, y: y - 4, width: W - 2 * M, height: rowH, color: rgb(0.95, 0.96, 0.98) });
      let x = M + 4;
      cells.forEach((c, i) => {
        let t = clean(c);
        while (t.length > 2 && f.widthOfTextAtSize(t, 8.5) > widths[i]! - 6) t = t.slice(0, -2);
        page.drawText(t, { x, y, size: 8.5, font: f, color: rgb(0.13, 0.15, 0.2) });
        x += widths[i]!;
      });
      y -= rowH;
    };
    drawRow(head, bold, true);
    rows.forEach((r, i) => {
      if (y - rowH < M) {
        newPage();
        drawRow(head, bold, true);
      }
      drawRow(r, font, i % 2 === 1);
    });
  };

  // Header with logo
  try {
    const bytes = await fs.readFile(path.join(process.cwd(), "public", BRAND.logo.replace(/^\//, "")));
    const img = await pdf.embedPng(bytes);
    const h = 46;
    page.drawImage(img, { x: M, y: y - h + 10, width: (img.width / img.height) * h, height: h });
  } catch {
    page.drawText(clean(brandName), { x: M, y: y - 10, size: 16, font: bold, color: NAVY });
  }
  page.drawText(clean(brandName), { x: W - M - bold.widthOfTextAtSize(clean(brandName), 10), y: y - 6, size: 10, font: bold, color: NAVY });
  y -= 56;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 1, color: rgb(0.88, 0.9, 0.93) });
  y -= 26;
  page.drawText(clean(report.title.split(" — ")[0]), { x: M, y, size: 20, font: bold, color: rgb(0.08, 0.1, 0.15) });
  y -= 18;
  const fmt = (dt: Date) => dt.toLocaleDateString("en-CA", { year: "numeric", month: "short", day: "numeric" });
  para(`${clientName}  |  ${fmt(report.periodStart)} - ${fmt(report.periodEnd)}`, 10, font, GREY);
  y -= 6;

  if (report.summary) {
    heading("Summary");
    para(report.summary, 10.5);
  }
  if (d) {
    heading("What was done");
    table(["Activity", "Count"], Object.entries(d.done).map(([k, v]) => [DONE_LABELS[k] ?? k, v]), [380, 119]);
    heading("Results");
    const pctTxt = (v: number | null) => (v == null ? "-" : `${v >= 0 ? "+" : ""}${v}%`);
    table(["Metric", "Value", "Change vs previous period"], [
      ["Google profile views", d.gbp.views, pctTxt(d.gbp.viewsChange)],
      ["Calls from Google", d.gbp.calls, pctTxt(d.gbp.callsChange)],
      ["Website clicks from Google profile", d.gbp.websiteClicks, "-"],
      ["Direction requests", d.gbp.directions, "-"],
      ["Search clicks (Search Console)", d.search.clicks, pctTxt(d.search.clicksChange)],
      ["Search impressions", d.search.impressions, "-"],
      ["Average keyword position", d.rankings.avgNow?.toFixed(1) ?? "-", d.rankings.avgPrev != null ? `was ${d.rankings.avgPrev.toFixed(1)}` : "-"],
      ["New reviews", d.reviews.new, d.reviews.avgRating != null ? `avg ${d.reviews.avgRating.toFixed(1)} stars` : "-"],
      ...(d.grid ? [[`Google Maps avg position ("${d.grid.keyword}")`, d.grid.avg?.toFixed(1) ?? "-", d.grid.prevAvg != null ? `was ${d.grid.prevAvg.toFixed(1)}` : "-"]] : []),
    ], [260, 90, 149]);
    heading("What improved");
    if (d.rankings.improved.length) for (const k of d.rankings.improved.slice(0, 12)) para(`- Ranking for "${k}"`);
    else para("Rankings held steady.");
    heading("What declined");
    if (d.rankings.declined.length) for (const k of d.rankings.declined.slice(0, 12)) para(`- Ranking for "${k}"`);
    else para("Nothing significant.");
    if (d.attention.openHighIssues) {
      heading("What needs attention");
      para(`${d.attention.openHighIssues} important website improvements are queued or awaiting approval.`);
    }
    heading("What's planned next");
    if (d.strategy) for (const p of d.strategy.priorities.slice(0, 5)) para(`- ${p.title}`);
    for (const n of d.next) para(`- ${new Date(n.scheduledFor).toLocaleDateString("en-CA", { month: "short", day: "numeric" })}: ${n.type === "BLOG" ? "Article" : "Google post"} - ${n.title}`);
  }
  if (keywords.length) {
    heading("Keyword positions");
    table(["Keyword", "Current", "Previous", "Best", "Maps"], keywords.map((k) => [k.phrase, k.currentPosition ?? "-", k.previousPosition ?? "-", k.bestPosition ?? "-", k.localPosition ?? "-"]), [259, 60, 60, 60, 60]);
  }
  if (daily.length) {
    heading("Daily Google Business Profile performance");
    table(["Date", "Maps views", "Search views", "Calls", "Website", "Directions"], daily.map((r) => [r.date.toISOString().slice(0, 10), r._sum.impressionsMaps ?? 0, r._sum.impressionsSearch ?? 0, r._sum.calls ?? 0, r._sum.websiteClicks ?? 0, r._sum.directionRequests ?? 0]), [99, 80, 80, 80, 80, 80]);
  }
  // Footer on every page
  const pages = pdf.getPages();
  pages.forEach((p, i) => {
    p.drawText(clean(`${brandName}  |  Generated ${new Date().toLocaleDateString("en-CA")}  |  Page ${i + 1} of ${pages.length}`), { x: M, y: 24, size: 8, font, color: GREY });
  });
  return pdf.save();
}

export async function reportCsv(report: Report, clientName: string): Promise<string> {
  const d = report.data as unknown as Data | null;
  const { daily, keywords } = await detail(report);
  const rows: (string | number | null)[][] = [
    ["Report", report.title],
    ["Client", clientName],
    ["Period start", report.periodStart.toISOString().slice(0, 10)],
    ["Period end", report.periodEnd.toISOString().slice(0, 10)],
    ["Summary", report.summary ?? ""],
    [],
    ["Section", "Metric", "Value", "Change %"],
  ];
  if (d) {
    for (const [k, v] of Object.entries(d.done)) rows.push(["Work done", DONE_LABELS[k] ?? k, v, ""]);
    rows.push(["Google Business Profile", "Views", d.gbp.views, d.gbp.viewsChange]);
    rows.push(["Google Business Profile", "Calls", d.gbp.calls, d.gbp.callsChange]);
    rows.push(["Google Business Profile", "Website clicks", d.gbp.websiteClicks, ""]);
    rows.push(["Google Business Profile", "Direction requests", d.gbp.directions, ""]);
    rows.push(["Search Console", "Clicks", d.search.clicks, d.search.clicksChange]);
    rows.push(["Search Console", "Impressions", d.search.impressions, ""]);
    rows.push(["Rankings", "Average position", d.rankings.avgNow?.toFixed(1) ?? "", ""]);
    rows.push(["Rankings", "Previous average position", d.rankings.avgPrev?.toFixed(1) ?? "", ""]);
    rows.push(["Reviews", "New reviews", d.reviews.new, ""]);
    rows.push(["Reviews", "Average rating", d.reviews.avgRating?.toFixed(2) ?? "", ""]);
    if (d.grid) rows.push(["Local map grid", `Average position (${d.grid.keyword})`, d.grid.avg ?? "", ""]);
  }
  rows.push([], ["Keyword", "Current", "Previous", "Best", "Maps position"]);
  for (const k of keywords) rows.push([k.phrase, k.currentPosition, k.previousPosition, k.bestPosition, k.localPosition]);
  rows.push([], ["Date", "Maps views", "Search views", "Calls", "Website clicks", "Direction requests"]);
  for (const r of daily) rows.push([r.date.toISOString().slice(0, 10), r._sum.impressionsMaps ?? 0, r._sum.impressionsSearch ?? 0, r._sum.calls ?? 0, r._sum.websiteClicks ?? 0, r._sum.directionRequests ?? 0]);
  const esc = (v: unknown) => {
    if (v == null) return "";
    let s = String(v);
    if (/^[=+\-@]/.test(s)) s = `'${s}`; // spreadsheet formula-injection guard
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return "﻿" + rows.map((r) => r.map(esc).join(",")).join("\r\n");
}
