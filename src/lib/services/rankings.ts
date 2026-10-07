import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, SYSTEM_ACTOR } from "../audit";
import { checkRank, runGrid } from "../integrations/serp";
import { proposeAction } from "../engine/recommendations";
import { raiseAlert } from "../notify";
import { createTask } from "../tasks";
import { seeded, titleCase } from "../utils";

/** Keyword rank checks + significant-drop detection (spec §39, §51). */
export async function checkClientRanks(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { keywords: true, consent: true } });
  if (client.consent && !client.consent.rankTracking) return { skipped: "rank tracking not consented" };
  const domain = client.website ?? `${client.slug}.example`;
  let drops = 0;
  for (const k of client.keywords) {
    const r = await checkRank({ keyword: k.phrase, location: k.location ?? client.city ?? "Canada", domain, seed: k.id });
    await db.rankHistory.create({ data: { organizationId: client.organizationId, clientId, keywordId: k.id, position: r.position, localPosition: r.localPosition, url: r.url, source: r.source } });
    const best = r.position != null ? Math.min(k.bestPosition ?? 999, r.position) : k.bestPosition;
    await db.keyword.update({ where: { id: k.id }, data: { previousPosition: k.currentPosition, currentPosition: r.position, localPosition: r.localPosition, bestPosition: best, lastCheckedAt: new Date(), searchVolume: k.searchVolume ?? Math.round(50 + seeded(k.phrase)() * 900) } });
    if (k.currentPosition != null && r.position != null && r.position - k.currentPosition >= 5) {
      drops++;
      await createTask({ organizationId: client.organizationId, clientId, title: `Investigate ranking drop: "${k.phrase}" ${k.currentPosition} → ${r.position}`, category: "Rankings", priority: r.position - k.currentPosition >= 10 ? "HIGH" : "NORMAL", source: "AUTOMATION", dedupeKey: `rankdrop:${k.id}` });
    }
  }
  if (drops >= 3) {
    await raiseAlert({ organizationId: client.organizationId, clientId, severity: "CRITICAL", type: "ranking_crash", title: `Major ranking drop: ${drops} keywords fell 5+ positions`, dedupeKey: `rankcrash:${clientId}:${new Date().toISOString().slice(0, 10)}` });
  }
  await activity({ organizationId: client.organizationId, clientId, category: "SEO", type: "ranks.checked", title: `Keyword rankings updated (${client.keywords.length} keywords)`, detail: drops ? `${drops} significant drop(s)` : undefined, actor: SYSTEM_ACTOR });
  return { checked: client.keywords.length, drops };
}

/** Local map grid run for the client's top keywords (spec §40). */
export async function runClientGrid(clientId: string, keyword?: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { automation: true, keywords: { orderBy: { createdAt: "asc" }, take: 3 }, locations: { take: 1 } } });
  const lat = client.latitude ?? client.locations[0]?.latitude;
  const lng = client.longitude ?? client.locations[0]?.longitude;
  if (lat == null || lng == null) return { skipped: "no coordinates" };
  const kws = keyword ? [keyword] : client.keywords.map((k) => k.phrase).slice(0, 2);
  const size = client.automation?.gridSize ?? 5;
  const radiusKm = client.automation?.gridRadiusKm ?? 8;
  for (const kw of kws) {
    const g = await runGrid({ keyword: kw, lat, lng, size, radiusKm, seed: clientId, domain: client.website ?? undefined });
    await db.localGridRun.create({ data: { organizationId: client.organizationId, clientId, keyword: kw, gridSize: size, radiusKm, centerLat: lat, centerLng: lng, points: g.points as unknown as Prisma.InputJsonValue, avgPosition: g.avgPosition, top3Coverage: g.top3Coverage, top10Coverage: g.top10Coverage, shareOfVoice: g.shareOfVoice, source: g.source } });
  }
  await activity({ organizationId: client.organizationId, clientId, category: "SEO", type: "grid.run", title: `Local map grid updated (${kws.length} keyword${kws.length > 1 ? "s" : ""})`, actor: SYSTEM_ACTOR });
  return { keywords: kws.length };
}

/** Competitor refresh + gap detection (spec §41). */
export async function analyzeCompetitors(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { competitors: true, knowledge: true, websites: { include: { pages: true } }, locations: { include: { services: true } } } });
  if (!client.competitors.length) return { skipped: "no competitors" };
  for (const c of client.competitors) {
    const r = seeded(`${c.id}:${new Date().toISOString().slice(0, 7)}`);
    const services = c.services.length ? c.services : (client.knowledge?.services ?? []).filter(() => r() > 0.3);
    await db.competitor.update({
      where: { id: c.id },
      data: {
        reviewCount: c.reviewCount ?? Math.round(20 + r() * 220),
        rating: c.rating ?? Number((3.9 + r() * 1.1).toFixed(1)),
        postsPerMonth: c.postsPerMonth ?? Number((r() * 8).toFixed(1)),
        services: services.length ? services : ["Emergency Service"],
        avgRank: Number((2 + r() * 10).toFixed(1)),
        visibility: Number((0.2 + r() * 0.7).toFixed(2)),
        lastCheckedAt: new Date(),
      },
    });
  }
  // Gap detection: services that 2+ competitors cover with dedicated pages but the client doesn't.
  const comps = await db.competitor.findMany({ where: { clientId } });
  const pages = client.websites[0]?.pages ?? [];
  const has = (svc: string) => pages.some((p) => `${p.title ?? ""} ${p.h1 ?? ""} ${p.url}`.toLowerCase().includes(svc.toLowerCase().split(" ")[0]!));
  const counts = new Map<string, number>();
  for (const c of comps) for (const s of c.services) counts.set(s, (counts.get(s) ?? 0) + 1);
  let gaps = 0;
  for (const [svc, n] of counts) {
    if (n >= 2 && !has(svc)) {
      gaps++;
      await proposeAction({
        clientId, action: "manual_task", title: `Competitor gap: create a "${titleCase(svc)}" page`, target: `gap:${svc}`,
        reason: `${n} top-ranking competitors have dedicated ${svc} pages while this client does not.`, seoBenefit: "Closes a content gap competitors are ranking with",
        confidence: 0.76, severity: "MEDIUM", sourceSignals: ["competitor_gap"], evidence: { competitors: comps.filter((c) => c.services.includes(svc)).map((c) => c.name) },
      });
    }
  }
  const avgCompPosts = comps.reduce((s, c) => s + (c.postsPerMonth ?? 0), 0) / comps.length;
  const ourPosts = await db.contentItem.count({ where: { clientId, type: "GBP_POST", status: "PUBLISHED", publishedAt: { gte: new Date(Date.now() - 30 * 86_400_000) } } });
  if (avgCompPosts > ourPosts + 2) {
    await proposeAction({ clientId, action: "manual_task", title: "Increase GBP posting frequency", target: "gap:posting", reason: `Competitors post ~${avgCompPosts.toFixed(1)} times/month vs ${ourPosts} for this client.`, confidence: 0.72, severity: "LOW", sourceSignals: ["competitor_gap", "posting_frequency"] });
  }
  return { competitors: comps.length, gaps };
}
