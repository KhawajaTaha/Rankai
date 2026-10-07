import type { GoogleConnection, Integration } from "@prisma/client";
import { googleFetch } from "./google-oauth";
import { addDays, isoDate, seeded } from "../utils";

export interface Ga4Row {
  date: string;
  landingPage: string;
  organicUsers: number;
  organicSessions: number;
  engagedSessions: number;
  conversions: number;
  leads: number;
}

/** GA4 Data API runReport filtered to Organic Search (live) or Demo data. */
export async function fetchGa4(integration: Integration, conn: GoogleConnection | null, days: number): Promise<Ga4Row[]> {
  if (integration.mode === "DEMO" || !conn) return demoGa4(integration.id, days);
  const property = integration.externalId; // "properties/123456"
  const r = await googleFetch<{ rows?: { dimensionValues: { value: string }[]; metricValues: { value: string }[] }[] }>(
    conn,
    `https://analyticsdata.googleapis.com/v1beta/${property}:runReport`,
    {
      method: "POST",
      body: JSON.stringify({
        dateRanges: [{ startDate: `${days}daysAgo`, endDate: "yesterday" }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }, { name: "engagedSessions" }, { name: "conversions" }, { name: "eventCount" }],
        dimensionFilter: { filter: { fieldName: "sessionDefaultChannelGroup", stringFilter: { value: "Organic Search" } } },
      }),
    },
  );
  return (r.rows ?? []).map((row) => {
    const d = row.dimensionValues[0]!.value;
    const m = row.metricValues.map((v) => Number(v.value));
    return { date: `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`, landingPage: "(all)", organicUsers: m[0]!, organicSessions: m[1]!, engagedSessions: m[2]!, conversions: m[3]!, leads: m[3]! };
  });
}

export async function listGa4Properties(conn: GoogleConnection) {
  if (conn.mode === "DEMO") return [{ property: "properties/000000", displayName: "Demo GA4 Property" }];
  const r = await googleFetch<{ accountSummaries?: { propertySummaries?: { property: string; displayName: string }[] }[] }>(conn, "https://analyticsadmin.googleapis.com/v1beta/accountSummaries");
  return (r.accountSummaries ?? []).flatMap((a) => a.propertySummaries ?? []);
}

function demoGa4(seed: string, days: number): Ga4Row[] {
  const r0 = seeded(seed);
  const base = 15 + r0() * 60;
  const out: Ga4Row[] = [];
  for (let d = days; d >= 1; d--) {
    const date = addDays(new Date(), -d);
    const r = seeded(`${seed}:${isoDate(date)}`);
    const trend = 1 + ((days - d) / days) * 0.25;
    const wk = [0, 6].includes(date.getDay()) ? 0.65 : 1;
    const users = Math.round(base * trend * wk * (0.8 + r() * 0.4));
    const sessions = Math.round(users * (1.1 + r() * 0.2));
    const conv = Math.round(sessions * (0.02 + r() * 0.03));
    out.push({ date: isoDate(date), landingPage: "(all)", organicUsers: users, organicSessions: sessions, engagedSessions: Math.round(sessions * 0.6), conversions: conv, leads: conv });
  }
  return out;
}
