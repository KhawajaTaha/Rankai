import type { GoogleConnection, Integration } from "@prisma/client";
import { googleFetch } from "./google-oauth";
import { addDays, isoDate, seeded } from "../utils";

export interface GscRow {
  date: string;
  query: string;
  page: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** Google Search Console Search Analytics (live) or Demo data. */
export async function fetchSearchAnalytics(integration: Integration, conn: GoogleConnection | null, days: number, ctx: { queries: string[]; site: string }): Promise<GscRow[]> {
  if (integration.mode === "DEMO" || !conn) return demoGsc(integration.id, days, ctx);
  const site = encodeURIComponent(integration.externalId ?? "");
  const end = addDays(new Date(), -2); // GSC data lags ~2 days
  const rows: GscRow[] = [];
  let startRow = 0;
  for (;;) {
    const r = await googleFetch<{ rows?: { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }[] }>(
      conn,
      `https://www.googleapis.com/webmasters/v3/sites/${site}/searchAnalytics/query`,
      {
        method: "POST",
        body: JSON.stringify({ startDate: isoDate(addDays(end, -days)), endDate: isoDate(end), dimensions: ["date", "query", "page"], rowLimit: 25000, startRow }),
      },
    );
    const batch = r.rows ?? [];
    rows.push(...batch.map((x) => ({ date: x.keys[0]!, query: x.keys[1]!, page: x.keys[2]!, clicks: x.clicks, impressions: x.impressions, ctr: x.ctr, position: x.position })));
    if (batch.length < 25000 || rows.length >= 100_000) break;
    startRow += 25000;
  }
  return rows;
}

export async function listGscSites(conn: GoogleConnection) {
  if (conn.mode === "DEMO") return [{ siteUrl: "sc-domain:demo.example", permissionLevel: "siteOwner" }];
  const r = await googleFetch<{ siteEntry?: { siteUrl: string; permissionLevel: string }[] }>(conn, "https://www.googleapis.com/webmasters/v3/sites");
  return r.siteEntry ?? [];
}

function demoGsc(seed: string, days: number, ctx: { queries: string[]; site: string }): GscRow[] {
  const out: GscRow[] = [];
  const queries = ctx.queries.length ? ctx.queries : ["local services"];
  queries.forEach((q, qi) => {
    const r0 = seeded(`${seed}:${q}`);
    const basePos = 2 + r0() * 18;
    const baseImpr = 8 + r0() * 60;
    const drift = (r0() - 0.5) * 0.08; // some queries grow, some decline
    const page = `${ctx.site.replace(/\/$/, "")}/${qi === 0 ? "" : q.split(" ").slice(0, 2).join("-")}`;
    for (let d = days; d >= 1; d--) {
      const date = addDays(new Date(), -d - 2);
      const r = seeded(`${seed}:${q}:${isoDate(date)}`);
      const position = Math.max(1, basePos + drift * (days - d) * -1 + (r() - 0.5) * 2);
      const impressions = Math.max(0, Math.round(baseImpr * (1 + drift * (days - d)) * (0.7 + r() * 0.6)));
      const ctrBase = position < 3 ? 0.18 : position < 5 ? 0.08 : position < 10 ? 0.03 : 0.008;
      const clicks = Math.round(impressions * ctrBase * (0.6 + r() * 0.8));
      out.push({ date: isoDate(date), query: q, page, clicks, impressions, ctr: impressions ? clicks / impressions : 0, position: Number(position.toFixed(1)) });
    }
  });
  return out;
}
