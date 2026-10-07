import { parse, type HTMLElement } from "node-html-parser";
import { seeded } from "../utils";

/**
 * Website crawler + on-page analyser. Respects robots.txt disallow rules for our user-agent,
 * stays on the site's host, and analyses each HTML page for the checks in spec §28.
 */
export interface CrawledPage {
  url: string;
  statusCode: number;
  redirectedTo?: string;
  title: string | null;
  metaDescription: string | null;
  h1s: string[];
  h2s: string[];
  wordCount: number;
  canonical: string | null;
  noindex: boolean;
  schemaTypes: string[];
  internalLinks: string[];
  externalLinks: string[];
  images: { src: string; alt: string | null }[];
  responseMs: number;
  bytes: number;
  textHash: string;
  builder: string | null;
}

export interface CrawlResult {
  pages: CrawledPage[];
  robotsTxt: string | null;
  sitemapUrl: string | null;
  sitemapUrls: string[];
  brokenLinks: { from: string; to: string; status: number }[];
  https: boolean;
  homepageMs: number | null;
  mode: "LIVE" | "DEMO";
}

const UA = "LocalSEOAutopilotBot/1.0 (+https://localseoautopilot.example/bot)";

async function get(url: string, timeoutMs = 15_000) {
  const t0 = Date.now();
  const res = await fetch(url, { headers: { "user-agent": UA, accept: "text/html,application/xhtml+xml,*/*" }, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  const body = res.headers.get("content-type")?.includes("text") || res.headers.get("content-type")?.includes("xml") ? await res.text() : "";
  return { res, body, ms: Date.now() - t0 };
}

function robotsDisallows(robots: string | null): string[] {
  if (!robots) return [];
  const out: string[] = [];
  let applies = false;
  for (const raw of robots.split("\n")) {
    const line = raw.split("#")[0]!.trim();
    const [k, ...rest] = line.split(":");
    const v = rest.join(":").trim();
    if (/^user-agent$/i.test(k ?? "")) applies = v === "*" || /localseoautopilot/i.test(v);
    else if (applies && /^disallow$/i.test(k ?? "") && v) out.push(v);
  }
  return out;
}

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

export function analyseHtml(url: string, html: string, host: string): Omit<CrawledPage, "statusCode" | "responseMs" | "bytes"> {
  const root = parse(html);
  const text = (root.querySelector("body")?.text ?? "").replace(/\s+/g, " ").trim();
  const links = root.querySelectorAll("a[href]").map((a: HTMLElement) => a.getAttribute("href") ?? "");
  const internal = new Set<string>();
  const external = new Set<string>();
  for (const href of links) {
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) continue;
    try {
      const u = new URL(href, url);
      u.hash = "";
      if (u.host === host) internal.add(u.toString());
      else if (u.protocol.startsWith("http")) external.add(u.toString());
    } catch {
      /* ignore malformed */
    }
  }
  const schemaTypes: string[] = [];
  for (const s of root.querySelectorAll('script[type="application/ld+json"]')) {
    try {
      const j = JSON.parse(s.text);
      for (const item of Array.isArray(j) ? j : j["@graph"] ?? [j]) if (item?.["@type"]) schemaTypes.push(String(item["@type"]));
    } catch {
      schemaTypes.push("INVALID_JSON_LD");
    }
  }
  const robotsMeta = root.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "";
  return {
    url,
    title: root.querySelector("title")?.text.trim() || null,
    metaDescription: root.querySelector('meta[name="description"]')?.getAttribute("content")?.trim() || null,
    h1s: root.querySelectorAll("h1").map((h) => h.text.trim()).filter(Boolean),
    h2s: root.querySelectorAll("h2").map((h) => h.text.trim()).filter(Boolean).slice(0, 20),
    wordCount: text ? text.split(" ").length : 0,
    canonical: root.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? null,
    noindex: /noindex/i.test(robotsMeta),
    schemaTypes,
    internalLinks: [...internal],
    externalLinks: [...external].slice(0, 50),
    images: root.querySelectorAll("img").map((img) => ({ src: img.getAttribute("src") ?? img.getAttribute("data-src") ?? "", alt: img.getAttribute("alt") ?? null })),
    textHash: hash(text.slice(0, 5000)),
    builder: /elementor/i.test(html) ? "elementor" : /wp-block-/i.test(html) ? "gutenberg" : null,
  };
}

export async function crawlSite(siteUrl: string, opts: { maxPages?: number; demo?: boolean; seed?: string; services?: string[]; city?: string } = {}): Promise<CrawlResult> {
  if (opts.demo) return demoCrawl(siteUrl, opts.seed ?? siteUrl, opts.services ?? [], opts.city ?? "");
  const start = new URL(siteUrl);
  const host = start.host;
  const maxPages = opts.maxPages ?? 150;
  let robotsTxt: string | null = null;
  try {
    const r = await get(`${start.origin}/robots.txt`, 8000);
    if (r.res.ok) robotsTxt = r.body.slice(0, 20_000);
  } catch {
    /* no robots */
  }
  const disallow = robotsDisallows(robotsTxt);
  const sitemapUrl = /sitemap:\s*(\S+)/i.exec(robotsTxt ?? "")?.[1] ?? `${start.origin}/sitemap.xml`;
  const sitemapUrls: string[] = [];
  try {
    const sm = await get(sitemapUrl, 10_000);
    if (sm.res.ok) {
      const locs = [...sm.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!);
      for (const loc of locs.slice(0, 20)) {
        if (/\.xml($|\?)/.test(loc)) {
          const child = await get(loc, 10_000).catch(() => null);
          if (child?.res.ok) sitemapUrls.push(...[...child.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]!));
        } else sitemapUrls.push(loc);
      }
    }
  } catch {
    /* no sitemap */
  }

  const queue = [start.toString(), ...sitemapUrls.filter((u) => u.includes(host))];
  const seen = new Set<string>();
  const pages: CrawledPage[] = [];
  const statusByUrl = new Map<string, number>();
  let homepageMs: number | null = null;
  while (queue.length && pages.length < maxPages) {
    const url = queue.shift()!;
    if (seen.has(url)) continue;
    seen.add(url);
    const path = new URL(url).pathname;
    if (disallow.some((d) => path.startsWith(d))) continue;
    if (/\.(jpg|jpeg|png|gif|webp|svg|pdf|zip|mp4|css|js)$/i.test(path)) continue;
    try {
      const { res, body, ms } = await get(url);
      statusByUrl.set(url, res.status);
      if (homepageMs == null) homepageMs = ms;
      const finalUrl = res.url || url;
      if (!res.headers.get("content-type")?.includes("html")) continue;
      const a = analyseHtml(finalUrl, body, host);
      pages.push({ ...a, url, statusCode: res.status, redirectedTo: finalUrl !== url ? finalUrl : undefined, responseMs: ms, bytes: body.length });
      for (const l of a.internalLinks) if (!seen.has(l) && queue.length < maxPages * 4) queue.push(l);
    } catch {
      statusByUrl.set(url, 0);
      pages.push({ url, statusCode: 0, title: null, metaDescription: null, h1s: [], h2s: [], wordCount: 0, canonical: null, noindex: false, schemaTypes: [], internalLinks: [], externalLinks: [], images: [], responseMs: 0, bytes: 0, textHash: "", builder: null });
    }
  }
  // Broken internal links: link targets that were crawled with 4xx/5xx/0.
  const brokenLinks: CrawlResult["brokenLinks"] = [];
  for (const p of pages) for (const l of p.internalLinks) {
    const st = statusByUrl.get(l);
    if (st !== undefined && (st >= 400 || st === 0)) brokenLinks.push({ from: p.url, to: l, status: st });
  }
  return { pages, robotsTxt, sitemapUrl: sitemapUrls.length ? sitemapUrl : null, sitemapUrls, brokenLinks, https: start.protocol === "https:", homepageMs, mode: "LIVE" };
}

function demoCrawl(siteUrl: string, seed: string, services: string[], city: string): CrawlResult {
  const base = siteUrl.replace(/\/$/, "");
  const r = seeded(seed);
  const svc = services.length ? services : ["Services"];
  const slugs = ["", "about", "contact", ...svc.map((s) => s.toLowerCase().replace(/[^a-z]+/g, "-")), "gallery", "faq", "blog", "blog/welcome-to-our-new-website"];
  const pages: CrawledPage[] = slugs.map((slug, i) => {
    const url = slug ? `${base}/${slug}/` : `${base}/`;
    const isService = i >= 3 && i < 3 + svc.length;
    const name = isService ? svc[i - 3]! : slug ? slug.split("/").pop()!.replace(/-/g, " ") : "Home";
    const thin = slug === "gallery" || (isService && r() < 0.4);
    return {
      url,
      statusCode: slug === "blog/welcome-to-our-new-website" && r() < 0.5 ? 404 : 200,
      title: r() < 0.2 ? null : `${name.replace(/\b\w/g, (c) => c.toUpperCase())}${r() < 0.5 ? ` | ${city}` : ""}`,
      metaDescription: r() < 0.45 ? null : `Learn about ${name} with our team in ${city}.`,
      h1s: r() < 0.15 ? [] : r() < 0.1 ? [name, "Welcome"] : [name],
      h2s: ["Why choose us", "Get in touch"],
      wordCount: thin ? 120 + Math.floor(r() * 150) : 450 + Math.floor(r() * 900),
      canonical: r() < 0.3 ? null : url,
      noindex: false,
      schemaTypes: i === 0 && r() < 0.5 ? ["LocalBusiness"] : [],
      internalLinks: slug === "faq" ? [] : [`${base}/`, `${base}/contact/`, ...(i === 0 ? svc.map((s) => `${base}/${s.toLowerCase().replace(/[^a-z]+/g, "-")}/`) : [])],
      externalLinks: [],
      images: Array.from({ length: 2 + Math.floor(r() * 6) }, (_, k) => ({ src: `${base}/wp-content/uploads/img-${i}-${k}.jpg`, alt: r() < 0.4 ? null : `${name} photo` })),
      responseMs: 300 + Math.floor(r() * 1800),
      bytes: 60_000 + Math.floor(r() * 400_000),
      textHash: `${slug}:${thin}`,
      builder: r() < 0.5 ? "elementor" : "gutenberg",
    };
  });
  const brokenLinks = pages.filter((p) => p.statusCode === 404).map((p) => ({ from: `${base}/blog/`, to: p.url, status: 404 }));
  return { pages, robotsTxt: "User-agent: *\nDisallow: /wp-admin/\nSitemap: " + base + "/sitemap_index.xml", sitemapUrl: `${base}/sitemap_index.xml`, sitemapUrls: pages.map((p) => p.url), brokenLinks, https: base.startsWith("https"), homepageMs: pages[0]!.responseMs, mode: "DEMO" };
}
