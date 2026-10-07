import tls from "node:tls";
import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, AI_ACTOR, SYSTEM_ACTOR } from "../audit";
import { crawlSite } from "../integrations/crawler";
import { fetchSearchAnalytics } from "../integrations/search-console";
import { fetchGa4 } from "../integrations/analytics";
import { wordpressClient } from "../integrations/wordpress";
import { auditCrawl } from "../scoring/website";
import { proposeAction } from "../engine/recommendations";
import { raiseAlert, resolveAlerts } from "../notify";
import { createTask } from "../tasks";
import { refreshOnboarding } from "./onboarding";
import { sha256 } from "../crypto";
import { addDays, isoDate, titleCase } from "../utils";

const sha256Short = (s: string) => sha256(s).slice(0, 32);

/** Demo websites (*.example or demo integrations) are crawled synthetically; everything else is crawled live. */
function isDemoSite(url: string, integrationMode?: string | null) {
  if (integrationMode === "DEMO") return true;
  try {
    return new URL(url).hostname.endsWith(".example");
  } catch {
    return true;
  }
}

/** Full website crawl + technical SEO audit + safe-fix recommendations (spec §28-30). */
export async function crawlAndAudit(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { knowledge: true, websites: true } });
  const website = client.websites[0];
  if (!website) return { skipped: "no website" };
  const integration = website.integrationId ? await db.integration.findUnique({ where: { id: website.integrationId } }) : null;
  const audit = await db.seoAudit.create({ data: { organizationId: client.organizationId, clientId, kind: "WEBSITE", status: "RUNNING", startedAt: new Date() } });
  try {
    const city = (client.city ?? "").split(",")[0]!.trim();
    const services = client.knowledge?.services ?? [];
    const demo = isDemoSite(website.url, integration?.mode);
    const crawl = await crawlSite(website.url, { demo, seed: website.id, services, city, maxPages: 120 });
    if (demo) await overlayAppliedChanges(clientId, crawl.pages);
    // WordPress mapping: attach post ids so safe fixes can be applied through the connector.
    const wp = wordpressClient(integration);
    const wpByUrl = new Map<string, { id: number; builder: string }>();
    if (wp) {
      const status = await wp.status();
      await db.website.update({ where: { id: website.id }, data: { platform: "wordpress", cms: status as unknown as Prisma.InputJsonValue } });
      for (const p of await wp.listPages()) wpByUrl.set(p.url.replace(/\/?$/, "/"), { id: p.id, builder: p.builder });
    }
    for (const p of crawl.pages) {
      const key = p.url.replace(/\/?$/, "/");
      const wpRef = wpByUrl.get(key);
      const inbound = crawl.pages.filter((o) => o.internalLinks.includes(p.url)).length;
      const prev = await db.websitePage.findUnique({ where: { websiteId_url: { websiteId: website.id, url: p.url } } });
      await db.websitePage.upsert({
        where: { websiteId_url: { websiteId: website.id, url: p.url } },
        create: {
          organizationId: client.organizationId, clientId, websiteId: website.id, url: p.url, externalId: wpRef ? String(wpRef.id) : null, statusCode: p.statusCode, title: p.title, metaDescription: p.metaDescription,
          h1: p.h1s[0] ?? null, h2s: p.h2s, wordCount: p.wordCount, canonical: p.canonical, indexable: !p.noindex, schemaTypes: p.schemaTypes, internalLinksOut: p.internalLinks.length, internalLinksIn: inbound,
          imagesMissingAlt: p.images.filter((i) => !i.alt).length, builder: wpRef?.builder ?? p.builder, contentHash: p.textHash, lastCrawledAt: new Date(),
        },
        update: {
          externalId: wpRef ? String(wpRef.id) : undefined, statusCode: p.statusCode, title: p.title, metaDescription: p.metaDescription, h1: p.h1s[0] ?? null, h2s: p.h2s, wordCount: p.wordCount, canonical: p.canonical,
          indexable: !p.noindex, schemaTypes: p.schemaTypes, internalLinksOut: p.internalLinks.length, internalLinksIn: inbound, imagesMissingAlt: p.images.filter((i) => !i.alt).length,
          builder: wpRef?.builder ?? p.builder, contentHash: p.textHash, lastCrawledAt: new Date(),
        },
      });
      // Major page change detection (spec §69)
      if (prev?.contentHash && p.textHash && prev.contentHash !== p.textHash && prev.wordCount && Math.abs((p.wordCount - prev.wordCount) / prev.wordCount) > 0.4) {
        await raiseAlert({ organizationId: client.organizationId, clientId, severity: "MEDIUM", type: "page_major_change", title: `Major content change detected on ${new URL(p.url).pathname}`, detail: `Word count ${prev.wordCount} → ${p.wordCount}`, dedupeKey: `page_change:${p.url}:${p.textHash}` });
      }
    }
    const { score, breakdown, issues } = auditCrawl(crawl, { city, services, homepage: crawl.pages[0]?.url ?? website.url });

    // Issue lifecycle: close issues that disappeared, keep fingerprints stable.
    const fingerprints = new Set(issues.map((i) => sha256Short(`${i.code}:${i.url ?? ""}`)));
    await db.seoIssue.updateMany({ where: { clientId, category: { not: "gbp" }, status: "OPEN", fingerprint: { notIn: [...fingerprints] } }, data: { status: "FIXED", resolvedAt: new Date() } });
    const openFps = new Set((await db.seoIssue.findMany({ where: { clientId, status: "OPEN" }, select: { fingerprint: true } })).map((x) => x.fingerprint));
    for (const i of issues) {
      const fp = sha256Short(`${i.code}:${i.url ?? ""}`);
      if (openFps.has(fp)) continue;
      await db.seoIssue.create({ data: { organizationId: client.organizationId, clientId, auditId: audit.id, code: i.code, category: i.category, severity: i.severity, title: i.title, detail: i.detail, url: i.url, autoFixable: i.autoFixable, fingerprint: fp } });
    }
    await db.website.update({ where: { id: website.id }, data: { lastCrawlAt: new Date(), robotsTxt: crawl.robotsTxt, sitemapUrl: crawl.sitemapUrl, responseMs: crawl.homepageMs } });
    await db.seoAudit.update({ where: { id: audit.id }, data: { status: "SUCCEEDED", score, breakdown, pagesCrawled: crawl.pages.length, completedAt: new Date(), summary: `${issues.length} issues across ${crawl.pages.length} pages (${crawl.mode === "DEMO" ? "demo crawl" : "live crawl"})` } });
    await db.client.update({ where: { id: clientId }, data: { seoScore: score } });
    await activity({ organizationId: client.organizationId, clientId, category: "WEBSITE", type: "website.audit", title: `Website audit completed — SEO score ${score}/100`, detail: `${crawl.pages.length} pages, ${issues.length} issues`, actor: AI_ACTOR });

    await recommendWebsiteFixes(clientId);
    const critical = issues.filter((i) => i.severity === "CRITICAL");
    for (const c of critical.slice(0, 5)) {
      await createTask({ organizationId: client.organizationId, clientId, title: `Critical SEO issue: ${c.title}`, description: c.url ?? undefined, category: "SEO", priority: "URGENT", source: "SEO_AUDIT", dedupeKey: `critical:${clientId}:${c.code}:${c.url ?? ""}` });
    }
    await refreshOnboarding(clientId);
    return { score, pages: crawl.pages.length, issues: issues.length };
  } catch (e) {
    await db.seoAudit.update({ where: { id: audit.id }, data: { status: "FAILED", completedAt: new Date(), summary: (e as Error).message.slice(0, 300) } });
    throw e;
  }
}

/**
 * Demo sites have no real server to receive our changes, so re-apply the platform's own applied
 * (non-rolled-back) changes onto the synthetic crawl — otherwise every audit would "rediscover"
 * already-fixed issues. Live crawls read the real site and need no overlay.
 */
async function overlayAppliedChanges(clientId: string, pages: Awaited<ReturnType<typeof crawlSite>>["pages"]) {
  const actions = await db.seoAction.findMany({ where: { clientId, status: { in: ["APPLIED", "VERIFIED"] } }, orderBy: { createdAt: "asc" } });
  for (const a of actions) {
    const page = pages.find((p) => p.url === a.target);
    if (!page) continue;
    if (a.field === "update_meta_description") page.metaDescription = a.afterValue;
    if (a.field === "update_seo_title") page.title = a.afterValue;
    if (a.field === "update_image_alt") page.images = page.images.map((im) => ({ ...im, alt: im.alt ?? "described" }));
    if (a.field === "add_local_business_schema") page.schemaTypes = [...page.schemaTypes, "LocalBusiness"];
    if (a.field === "add_faq_schema") page.schemaTypes = [...page.schemaTypes, "FAQPage"];
    if (a.field === "add_internal_link") {
      const to = /→\s*(\S+)$/.exec(a.afterValue ?? "")?.[1];
      if (to && !page.internalLinks.includes(to)) page.internalLinks.push(to);
    }
  }
}

/** Turn open, auto-fixable issues into structured recommendations (risk engine decides). */
export async function recommendWebsiteFixes(clientId: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { knowledge: true } });
  const website = await db.website.findFirst({ where: { clientId }, include: { pages: true } });
  if (!website) return 0;
  const issues = await db.seoIssue.findMany({ where: { clientId, status: "OPEN", category: { not: "gbp" } }, take: 200 });
  const city = (client.city ?? "").split(",")[0]!.trim();
  const services = client.knowledge?.services ?? [];
  let n = 0;
  const home = website.pages.find((p) => new URL(p.url).pathname === "/") ?? website.pages[0];
  for (const i of issues) {
    const page = website.pages.find((p) => p.url === i.url);
    if (i.code === "missing_meta_description" && page) {
      const topic = page.h1 ?? page.title ?? titleCase(new URL(page.url).pathname.replace(/[/-]+/g, " ").trim() || "Home");
      const svc = services.find((s) => topic.toLowerCase().includes(s.toLowerCase().split(" ")[0]!)) ?? services[0] ?? "our services";
      const meta = `${topic} in ${city || "your area"} from ${client.name}. Learn about ${svc.toLowerCase()}, what to expect and how to get started — contact us today.`.slice(0, 158);
      await proposeAction({ clientId, action: "update_meta_description", title: `Add meta description: ${new URL(page.url).pathname}`, target: page.url, reason: "Page has no meta description; Google may show an unhelpful snippet.", seoBenefit: "Better click-through rate from search results", currentValue: null, suggestedValue: meta, confidence: 0.9, severity: "MEDIUM", sourceSignals: ["seo_audit_issue"] });
      n++;
    } else if (i.code === "missing_alt" && page) {
      const base = page.h1 ?? page.title ?? client.name;
      await proposeAction({ clientId, action: "update_image_alt", title: `Add image alt text: ${new URL(page.url).pathname}`, target: page.url, reason: i.title, seoBenefit: "Accessibility and image search relevance", suggestedValue: `${base} — images described for accessibility`, confidence: 0.88, severity: "LOW", sourceSignals: ["seo_audit_issue"], payload: { images: [{ src: `${page.url}#images`, alt: `${base} in ${city}` }] } });
      n++;
    } else if (i.code === "missing_localbusiness_schema" && home) {
      const jsonld = { "@context": "https://schema.org", "@type": "LocalBusiness", name: client.name, url: website.url, telephone: client.phone ?? undefined, address: client.address ? { "@type": "PostalAddress", streetAddress: client.address, addressLocality: city || undefined } : undefined, areaServed: client.knowledge?.serviceAreas ?? undefined };
      await proposeAction({ clientId, action: "add_local_business_schema", title: "Add LocalBusiness structured data to homepage", target: home.url, reason: "Homepage lacks LocalBusiness schema.", seoBenefit: "Helps Google understand the business, location and contact details", suggestedValue: JSON.stringify(jsonld, null, 1), confidence: 0.86, severity: "MEDIUM", sourceSignals: ["seo_audit_issue"] });
      n++;
    } else if (i.code === "orphan_page" && page && home && page.url !== home.url) {
      const anchor = page.h1 ?? page.title ?? titleCase(new URL(page.url).pathname.replace(/[/-]+/g, " ").trim());
      await proposeAction({ clientId, action: "add_internal_link", title: `Link to orphan page ${new URL(page.url).pathname}`, target: home.url, reason: "No internal links point to this page, so it is hard for users and Google to find.", seoBenefit: "Improves crawlability and passes link equity", currentValue: null, suggestedValue: `Link "${anchor}" → ${page.url}`, confidence: 0.84, severity: "MEDIUM", sourceSignals: ["seo_audit_issue"], payload: { anchor, url: page.url }, dedupeKey: `add_internal_link:${page.url}` });
      n++;
    } else if (i.code === "thin_content" && page) {
      await proposeAction({ clientId, action: "rewrite_page_content", title: `Expand thin page ${new URL(page.url).pathname}`, target: page.url, reason: `${i.title}. Thin pages rarely rank for competitive local searches.`, seoBenefit: "More helpful content for users and stronger relevance", currentValue: `${page.wordCount ?? 0} words`, suggestedValue: "Expand to 600+ words with FAQs, service details and local context (builder-safe manual update).", confidence: 0.7, severity: "MEDIUM", sourceSignals: ["seo_audit_issue"] });
      n++;
    } else if (i.code === "no_city_mentions" && home) {
      await proposeAction({ clientId, action: "update_seo_title", title: "Add location to homepage title", target: home.url, reason: i.title, seoBenefit: "Local relevance for searches including the city", currentValue: home.title, suggestedValue: `${services[0] ?? client.name} in ${city} | ${client.name}`.slice(0, 60), confidence: 0.83, severity: "HIGH", sourceSignals: ["seo_audit_issue", "local_relevance"] });
      n++;
    } else if (i.code === "missing_service_page") {
      const svc = /"(.+)"/.exec(i.title)?.[1] ?? "service";
      await proposeAction({ clientId, action: "manual_task", title: `Create a dedicated page for ${svc}`, target: `service-page:${svc}`, reason: "Dedicated service pages are a key ranking factor for local service searches.", seoBenefit: "Ranks for service-specific searches and supports GBP relevance", confidence: 0.8, severity: "MEDIUM", sourceSignals: ["content_gap"] });
      n++;
    }
  }
  return n;
}

/** Availability, SSL, robots.txt and sitemap monitoring (spec §69). */
export async function monitorWebsite(clientId: string) {
  const website = await db.website.findFirst({ where: { clientId }, include: { client: true } });
  if (!website) return { skipped: "no website" };
  const integration = website.integrationId ? await db.integration.findUnique({ where: { id: website.integrationId } }) : null;
  const orgId = website.organizationId;
  if (isDemoSite(website.url, integration?.mode)) {
    await db.website.update({ where: { id: website.id }, data: { isUp: true, lastCheckedAt: new Date(), sslValidUntil: addDays(new Date(), 70) } });
    return { up: true, mode: "DEMO" };
  }
  let up = false;
  let ms: number | null = null;
  try {
    const t0 = Date.now();
    const res = await fetch(website.url, { method: "GET", redirect: "follow", signal: AbortSignal.timeout(15_000), headers: { "user-agent": "LocalSEOAutopilotMonitor/1.0" } });
    ms = Date.now() - t0;
    up = res.status < 500;
  } catch {
    up = false;
  }
  const sslValidUntil = await sslExpiry(website.url).catch(() => null);
  if (!up) {
    await raiseAlert({ organizationId: orgId, clientId, severity: "CRITICAL", type: "website_offline", title: `Website offline: ${website.url}`, dedupeKey: `website_down:${website.id}` });
    await createTask({ organizationId: orgId, clientId, title: "Website is down — investigate", category: "Technical", priority: "URGENT", source: "AUTOMATION", dedupeKey: `website_down:${website.id}` });
  } else await resolveAlerts(orgId, `website_down:${website.id}`);
  if (sslValidUntil && sslValidUntil < addDays(new Date(), 14)) {
    await raiseAlert({ organizationId: orgId, clientId, severity: sslValidUntil < new Date() ? "CRITICAL" : "HIGH", type: "ssl_expiring", title: `SSL certificate ${sslValidUntil < new Date() ? "expired" : "expires soon"} (${isoDate(sslValidUntil)})`, dedupeKey: `ssl:${website.id}:${isoDate(sslValidUntil)}` });
  }
  if (website.responseMs && ms && ms > website.responseMs * 2.5 && ms > 3000) {
    await raiseAlert({ organizationId: orgId, clientId, severity: "MEDIUM", type: "site_slow", title: `Site speed deteriorated (${(ms / 1000).toFixed(1)}s)`, dedupeKey: `slow:${website.id}:${isoDate(new Date())}` });
  }
  try {
    const robots = await fetch(new URL("/robots.txt", website.url), { signal: AbortSignal.timeout(8000) }).then((r) => (r.ok ? r.text() : null));
    if (robots && /Disallow:\s*\/\s*$/m.test(robots) && /User-agent:\s*\*/i.test(robots)) {
      await raiseAlert({ organizationId: orgId, clientId, severity: "CRITICAL", type: "robots_blocking", title: "robots.txt is blocking the whole site", dedupeKey: `robots_block:${website.id}` });
    }
    await db.website.update({ where: { id: website.id }, data: { robotsTxt: robots?.slice(0, 20_000) ?? website.robotsTxt } });
  } catch {
    /* ignore */
  }
  await db.website.update({ where: { id: website.id }, data: { isUp: up, lastCheckedAt: new Date(), sslValidUntil: sslValidUntil ?? undefined, responseMs: website.responseMs ?? ms } });
  return { up, ms, sslValidUntil };
}

function sslExpiry(url: string): Promise<Date | null> {
  const u = new URL(url);
  if (u.protocol !== "https:") return Promise.resolve(null);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host: u.hostname, port: 443, servername: u.hostname, timeout: 10_000 }, () => {
      const cert = socket.getPeerCertificate();
      socket.end();
      resolve(cert?.valid_to ? new Date(cert.valid_to) : null);
    });
    socket.on("error", reject);
    socket.on("timeout", () => {
      socket.destroy();
      reject(new Error("timeout"));
    });
  });
}

/** Search Console sync + opportunity engine (spec §37). */
export async function syncSearchConsole(clientId: string) {
  const integration = await db.integration.findFirst({ where: { clientId, kind: "GOOGLE_SEARCH_CONSOLE" } });
  if (!integration || integration.status !== "CONNECTED") return { skipped: "not connected" };
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { keywords: true, websites: true } });
  const conn = integration.googleConnectionId ? await db.googleConnection.findUnique({ where: { id: integration.googleConnectionId } }) : null;
  const queries = [...new Set([...client.keywords.map((k) => k.phrase), ...client.keywords.map((k) => k.phrase.split(" ").slice(0, 2).join(" ")), `${client.name.toLowerCase()}`])].slice(0, 25);
  const rows = await fetchSearchAnalytics(integration, conn, 90, { queries, site: client.websites[0]?.url ?? client.website ?? "https://example.com/" });
  await db.gscMetric.deleteMany({ where: { clientId, date: { gte: addDays(new Date(), -95) } } });
  for (let i = 0; i < rows.length; i += 1000) {
    await db.gscMetric.createMany({ data: rows.slice(i, i + 1000).map((r) => ({ organizationId: client.organizationId, clientId, date: new Date(`${r.date}T00:00:00Z`), query: r.query, page: r.page, clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) });
  }
  await db.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date(), lastError: null, errorCount: 0 } });
  const opps = await searchOpportunities(clientId);
  for (const o of opps.slice(0, 6)) {
    if (o.type === "striking_distance" || o.type === "high_impr_low_ctr") {
      await proposeAction({
        clientId, action: o.type === "high_impr_low_ctr" ? "update_seo_title" : "create_supporting_blog", title: o.type === "high_impr_low_ctr" ? `Improve title for "${o.query}" (CTR ${(o.ctr * 100).toFixed(1)}%)` : `Supporting blog for "${o.query}" (position ${o.position.toFixed(1)})`,
        target: o.type === "high_impr_low_ctr" ? o.page : `blog:${o.query}`, reason: o.reason, seoBenefit: o.type === "high_impr_low_ctr" ? "More clicks from existing impressions" : "Push a page-two query onto page one",
        currentValue: o.type === "high_impr_low_ctr" ? (await db.websitePage.findFirst({ where: { clientId, url: o.page } }))?.title ?? null : null,
        suggestedValue: o.type === "high_impr_low_ctr" ? `${titleCase(o.query)} | ${client.name}`.slice(0, 60) : `${titleCase(o.query)}: a local guide`,
        confidence: 0.78, severity: "MEDIUM", sourceSignals: ["search_console_opportunity"], evidence: o as unknown as Record<string, unknown>, payload: { keyword: o.query },
        expectedImpact: `~${Math.round(o.impressions * 0.03)} extra clicks / 90d`,
      });
    }
  }
  return { rows: rows.length, opportunities: opps.length };
}

export async function searchOpportunities(clientId: string) {
  const since = addDays(new Date(), -90);
  const mid = addDays(new Date(), -45);
  const rows = await db.gscMetric.findMany({ where: { clientId, date: { gte: since } } });
  const by = new Map<string, { query: string; page: string; impressions: number; clicks: number; posSum: number; n: number; recent: number; older: number }>();
  for (const r of rows) {
    const k = r.query;
    const e = by.get(k) ?? { query: r.query, page: r.page ?? "", impressions: 0, clicks: 0, posSum: 0, n: 0, recent: 0, older: 0 };
    e.impressions += r.impressions;
    e.clicks += r.clicks;
    e.posSum += r.position * r.impressions;
    e.n += r.impressions;
    if (r.date >= mid) e.recent += r.clicks;
    else e.older += r.clicks;
    by.set(k, e);
  }
  const out: { type: string; query: string; page: string; impressions: number; clicks: number; ctr: number; position: number; reason: string; change?: number }[] = [];
  for (const e of by.values()) {
    const position = e.n ? e.posSum / e.n : 100;
    const ctr = e.impressions ? e.clicks / e.impressions : 0;
    const base = { query: e.query, page: e.page, impressions: e.impressions, clicks: e.clicks, ctr, position };
    if (e.impressions > 300 && ctr < 0.02 && position < 10) out.push({ ...base, type: "high_impr_low_ctr", reason: `High impressions (${e.impressions}) but low CTR (${(ctr * 100).toFixed(1)}%) at position ${position.toFixed(1)}.` });
    else if (position >= 4 && position <= 15 && e.impressions > 100) out.push({ ...base, type: "striking_distance", reason: `Position ${position.toFixed(1)} with ${e.impressions} impressions — close to the top results.` });
    if (e.older > 10 && e.recent > e.older * 1.3) out.push({ ...base, type: "growing", change: e.recent - e.older, reason: `Clicks growing (${e.older} → ${e.recent}).` });
    if (e.older > 10 && e.recent < e.older * 0.7) out.push({ ...base, type: "declining", change: e.recent - e.older, reason: `Clicks declining (${e.older} → ${e.recent}).` });
  }
  return out.sort((a, b) => b.impressions - a.impressions);
}

/** GA4 organic performance sync (spec §38). */
export async function syncGa4(clientId: string) {
  const integration = await db.integration.findFirst({ where: { clientId, kind: "GOOGLE_ANALYTICS_4" } });
  if (!integration || integration.status !== "CONNECTED") return { skipped: "not connected" };
  const conn = integration.googleConnectionId ? await db.googleConnection.findUnique({ where: { id: integration.googleConnectionId } }) : null;
  const rows = await fetchGa4(integration, conn, 400);
  for (const r of rows) {
    const date = new Date(`${r.date}T00:00:00Z`);
    await db.ga4Metric.upsert({
      where: { clientId_date_landingPage: { clientId, date, landingPage: r.landingPage } },
      create: { organizationId: integration.organizationId, clientId, date, landingPage: r.landingPage, organicUsers: r.organicUsers, organicSessions: r.organicSessions, engagedSessions: r.engagedSessions, conversions: r.conversions, leads: r.leads },
      update: { organicUsers: r.organicUsers, organicSessions: r.organicSessions, engagedSessions: r.engagedSessions, conversions: r.conversions, leads: r.leads },
    });
  }
  await db.integration.update({ where: { id: integration.id }, data: { lastSyncAt: new Date(), lastError: null, errorCount: 0 } });
  await activity({ organizationId: integration.organizationId, clientId, category: "SEO", type: "ga4.synced", title: `GA4 synced (${rows.length} days)`, actor: SYSTEM_ACTOR });
  return { days: rows.length };
}
