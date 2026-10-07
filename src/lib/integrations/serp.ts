import { env, modes } from "../env";
import { seeded, isoDate } from "../utils";

/**
 * Rank tracking provider. LIVE uses DataForSEO's Google Organic + Maps live endpoints;
 * DEMO produces stable, slowly-drifting positions so trends are realistic.
 */
export interface RankResult {
  position: number | null;
  localPosition: number | null;
  url: string | null;
  source: "LIVE" | "DEMO";
}

export async function checkRank(args: { keyword: string; location: string; domain: string; seed: string }): Promise<RankResult> {
  if (!modes.serpLive() || env.serpProvider !== "dataforseo") return demoRank(args);
  const auth = Buffer.from(`${env.serpLogin}:${env.serpPassword}`).toString("base64");
  const post = async (path: string) => {
    const res = await fetch(`https://api.dataforseo.com/v3/serp/google/${path}/live/advanced`, {
      method: "POST",
      headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
      body: JSON.stringify([{ keyword: args.keyword, location_name: args.location, language_code: "en", depth: 100 }]),
    });
    if (!res.ok) throw new Error(`SERP provider ${res.status}`);
    return (await res.json()) as { tasks?: { result?: { items?: { type: string; rank_group: number; url?: string; domain?: string; title?: string }[] }[] }[] };
  };
  const host = args.domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  const organic = await post("organic");
  const items = organic.tasks?.[0]?.result?.[0]?.items ?? [];
  const hit = items.find((i) => i.type === "organic" && i.domain?.replace(/^www\./, "") === host);
  const maps = await post("maps");
  const mapItems = maps.tasks?.[0]?.result?.[0]?.items ?? [];
  const mapHit = mapItems.find((i) => i.domain?.replace(/^www\./, "") === host);
  return { position: hit?.rank_group ?? null, localPosition: mapHit?.rank_group ?? null, url: hit?.url ?? null, source: "LIVE" };
}

function demoRank(args: { keyword: string; seed: string; domain: string }): RankResult {
  const r0 = seeded(`${args.seed}:${args.keyword}`);
  const base = 3 + r0() * 25;
  const weeks = Math.floor(Date.now() / (7 * 86_400_000));
  const r = seeded(`${args.seed}:${args.keyword}:${isoDate(new Date())}`);
  const improve = Math.min(6, (weeks % 52) * 0.08);
  const position = Math.max(1, Math.round(base - improve + (r() - 0.5) * 3));
  const local = Math.max(1, Math.round(position * 0.6 + (r() - 0.5) * 2));
  return { position: position > 100 ? null : position, localPosition: local > 20 ? null : local, url: args.domain, source: "DEMO" };
}

/** Local map grid: positions across a lat/lng grid around the business. */
export async function runGrid(args: { keyword: string; lat: number; lng: number; size: number; radiusKm: number; seed: string; domain?: string }) {
  const live = modes.serpLive() && env.serpProvider === "dataforseo" && Boolean(args.domain);
  const pts: { row: number; col: number; lat: number; lng: number; position: number | null }[] = [];
  const half = (args.size - 1) / 2;
  const kmLat = 1 / 110.574;
  const kmLng = 1 / (111.32 * Math.cos((args.lat * Math.PI) / 180));
  const step = half ? args.radiusKm / half : 0;
  const r0 = seeded(`${args.seed}:${args.keyword}`);
  const strength = 1 + r0() * 3;
  const weeks = Math.floor(Date.now() / (7 * 86_400_000));
  for (let row = 0; row < args.size; row++) {
    for (let col = 0; col < args.size; col++) {
      const dy = (row - half) * step;
      const dx = (col - half) * step;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const lat = args.lat + dy * kmLat;
      const lng = args.lng + dx * kmLng;
      if (live) {
        pts.push({ row, col, lat, lng, position: await liveMapPosition(args.keyword, lat, lng, args.domain!) });
        continue;
      }
      const r = seeded(`${args.seed}:${args.keyword}:${row}:${col}:${weeks}`);
      const p = Math.round(strength + dist * (0.9 + r() * 0.8) + (r() - 0.5) * 2);
      pts.push({ row, col, lat, lng, position: p > 20 ? null : Math.max(1, p) });
    }
  }
  const ranked = pts.map((p) => p.position ?? 21);
  const avg = ranked.reduce((a, b) => a + b, 0) / ranked.length;
  const top3 = pts.filter((p) => p.position != null && p.position <= 3).length / pts.length;
  const top10 = pts.filter((p) => p.position != null && p.position <= 10).length / pts.length;
  // Share of Local Voice: weighted visibility (1st=1.0 … 20th≈0.05)
  const sov = pts.reduce((s, p) => s + (p.position ? Math.max(0, (21 - p.position) / 20) : 0), 0) / pts.length;
  return { points: pts, avgPosition: Number(avg.toFixed(1)), top3Coverage: top3, top10Coverage: top10, shareOfVoice: sov, source: live ? "LIVE" : "DEMO" };
}

async function liveMapPosition(keyword: string, lat: number, lng: number, domain: string): Promise<number | null> {
  const auth = Buffer.from(`${env.serpLogin}:${env.serpPassword}`).toString("base64");
  const res = await fetch("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
    method: "POST",
    headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify([{ keyword, location_coordinate: `${lat.toFixed(6)},${lng.toFixed(6)},15z`, language_code: "en", depth: 20 }]),
  });
  if (!res.ok) throw new Error(`SERP provider ${res.status}`);
  const json = (await res.json()) as { tasks?: { result?: { items?: { rank_group: number; domain?: string }[] }[] }[] };
  const host = domain.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
  return json.tasks?.[0]?.result?.[0]?.items?.find((i) => i.domain?.replace(/^www\./, "") === host)?.rank_group ?? null;
}
