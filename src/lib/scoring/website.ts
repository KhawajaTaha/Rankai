import type { Severity } from "@prisma/client";
import type { CrawlResult } from "../integrations/crawler";

export interface WebsiteIssue {
  code: string;
  category: "technical" | "on_page" | "content" | "links" | "images" | "schema" | "performance" | "local";
  severity: Severity;
  title: string;
  detail?: string;
  url?: string;
  autoFixable: boolean;
}

/** Turn a crawl into issues + category scores (spec §28-29). */
export function auditCrawl(crawl: CrawlResult, ctx: { city: string; services: string[]; homepage: string }) {
  const issues: WebsiteIssue[] = [];
  const ok = crawl.pages.filter((p) => p.statusCode >= 200 && p.statusCode < 300);
  const push = (i: WebsiteIssue) => issues.push(i);

  if (!crawl.https) push({ code: "no_https", category: "technical", severity: "CRITICAL", title: "Site is not served over HTTPS", autoFixable: false });
  if (!crawl.robotsTxt) push({ code: "missing_robots", category: "technical", severity: "LOW", title: "robots.txt not found", autoFixable: false });
  if (!crawl.sitemapUrl) push({ code: "missing_sitemap", category: "technical", severity: "MEDIUM", title: "XML sitemap not found", autoFixable: false });
  if (/Disallow:\s*\/\s*$/m.test(crawl.robotsTxt ?? "")) push({ code: "robots_blocks_all", category: "technical", severity: "CRITICAL", title: "robots.txt blocks the entire site", autoFixable: false });

  for (const p of crawl.pages) {
    if (p.statusCode >= 400 || p.statusCode === 0) push({ code: "broken_page", category: "technical", severity: p.url === ctx.homepage ? "CRITICAL" : "HIGH", title: `Page returns ${p.statusCode || "no response"}`, url: p.url, autoFixable: false });
  }
  for (const b of crawl.brokenLinks) push({ code: "broken_link", category: "links", severity: "MEDIUM", title: "Broken internal link", detail: `Links to ${b.to} (${b.status})`, url: b.from, autoFixable: true });

  const titles = new Map<string, string[]>();
  const hashes = new Map<string, string[]>();
  const inbound = new Map<string, number>();
  for (const p of ok) for (const l of p.internalLinks) inbound.set(l, (inbound.get(l) ?? 0) + 1);

  for (const p of ok) {
    if (p.noindex) push({ code: "noindex", category: "technical", severity: "HIGH", title: "Page is set to noindex", url: p.url, autoFixable: false });
    if (!p.title) push({ code: "missing_title", category: "on_page", severity: "HIGH", title: "Missing title tag", url: p.url, autoFixable: false });
    else {
      if (p.title.length > 60) push({ code: "long_title", category: "on_page", severity: "LOW", title: "Title longer than 60 characters", url: p.url, autoFixable: false });
      titles.set(p.title, [...(titles.get(p.title) ?? []), p.url]);
    }
    if (!p.metaDescription) push({ code: "missing_meta_description", category: "on_page", severity: "MEDIUM", title: "Missing meta description", url: p.url, autoFixable: true });
    else if (p.metaDescription.length < 70 || p.metaDescription.length > 160) push({ code: "meta_description_length", category: "on_page", severity: "LOW", title: "Meta description length not optimal", url: p.url, autoFixable: true });
    if (p.h1s.length === 0) push({ code: "missing_h1", category: "on_page", severity: "MEDIUM", title: "Missing H1", url: p.url, autoFixable: false });
    if (p.h1s.length > 1) push({ code: "multiple_h1", category: "on_page", severity: "LOW", title: `${p.h1s.length} H1 headings`, url: p.url, autoFixable: false });
    if (!p.canonical) push({ code: "missing_canonical", category: "technical", severity: "LOW", title: "No canonical tag", url: p.url, autoFixable: false });
    if (p.wordCount < 300) push({ code: "thin_content", category: "content", severity: "MEDIUM", title: `Thin content (${p.wordCount} words)`, url: p.url, autoFixable: false });
    const missingAlt = p.images.filter((im) => !im.alt).length;
    if (missingAlt) push({ code: "missing_alt", category: "images", severity: "LOW", title: `${missingAlt} image${missingAlt > 1 ? "s" : ""} missing alt text`, url: p.url, autoFixable: true });
    if (p.schemaTypes.includes("INVALID_JSON_LD")) push({ code: "invalid_schema", category: "schema", severity: "MEDIUM", title: "Invalid structured data", url: p.url, autoFixable: false });
    if (p.responseMs > 2500) push({ code: "slow_page", category: "performance", severity: "MEDIUM", title: `Slow response (${(p.responseMs / 1000).toFixed(1)}s)`, url: p.url, autoFixable: false });
    if (p.bytes > 1_500_000) push({ code: "heavy_page", category: "performance", severity: "LOW", title: "Large page size", url: p.url, autoFixable: false });
    if (p.url !== ctx.homepage && !inbound.get(p.url)) push({ code: "orphan_page", category: "links", severity: "MEDIUM", title: "Orphan page (no internal links point here)", url: p.url, autoFixable: true });
    if (p.textHash) hashes.set(p.textHash, [...(hashes.get(p.textHash) ?? []), p.url]);
  }
  for (const [t, urls] of titles) if (urls.length > 1) push({ code: "duplicate_title", category: "on_page", severity: "MEDIUM", title: `Duplicate title "${t.slice(0, 50)}"`, detail: urls.join(", "), url: urls[0], autoFixable: false });
  for (const [, urls] of hashes) if (urls.length > 1) push({ code: "duplicate_content", category: "content", severity: "MEDIUM", title: "Duplicate content", detail: urls.join(", "), url: urls[0], autoFixable: false });

  const home = ok.find((p) => p.url === ctx.homepage) ?? ok[0];
  if (home && !home.schemaTypes.some((t) => /LocalBusiness|Organization|Store|Dentist|Plumber|Attorney|HomeAndConstructionBusiness/i.test(t))) {
    push({ code: "missing_localbusiness_schema", category: "schema", severity: "MEDIUM", title: "Homepage has no LocalBusiness structured data", url: home.url, autoFixable: true });
  }
  const allText = ok.map((p) => `${p.title ?? ""} ${p.h1s.join(" ")} ${p.metaDescription ?? ""}`).join(" ").toLowerCase();
  if (ctx.city && !allText.includes(ctx.city.toLowerCase())) push({ code: "no_city_mentions", category: "local", severity: "HIGH", title: `Titles/headings never mention ${ctx.city}`, autoFixable: false });
  for (const s of ctx.services) {
    const words = s.toLowerCase();
    if (!ok.some((p) => `${p.title ?? ""} ${p.h1s.join(" ")}`.toLowerCase().includes(words))) {
      push({ code: "missing_service_page", category: "local", severity: "MEDIUM", title: `No dedicated page for "${s}"`, autoFixable: false });
    }
  }

  const cats = ["technical", "on_page", "content", "links", "images", "schema", "performance", "local"] as const;
  const penalty: Record<Severity, number> = { CRITICAL: 30, HIGH: 12, MEDIUM: 5, LOW: 2 };
  const pageFactor = Math.max(1, ok.length / 6);
  const breakdown: Record<string, number> = {};
  for (const c of cats) {
    const p = issues.filter((i) => i.category === c).reduce((s, i) => s + penalty[i.severity], 0);
    breakdown[c] = Math.max(0, Math.round(100 - p / pageFactor));
  }
  const weights: Record<string, number> = { technical: 0.2, on_page: 0.18, content: 0.14, links: 0.1, images: 0.06, schema: 0.08, performance: 0.1, local: 0.14 };
  const overall = Math.round(cats.reduce((s, c) => s + breakdown[c]! * weights[c]!, 0));
  return { score: overall, breakdown, issues };
}
