import type { Integration } from "@prisma/client";
import { decryptJson, hmacSha256 } from "../crypto";

/**
 * Client for the "Local SEO Autopilot Connector" WordPress plugin (see /wordpress-plugin).
 * Every request is HMAC-signed with the per-site shared secret; the plugin rejects unsigned or
 * replayed (>5 min) requests. Demo-mode integrations never call out.
 */
export interface WpStatus {
  wpVersion: string;
  theme: string;
  plugins: string[];
  elementor: boolean;
  seoPlugin: "rank_math" | "yoast" | "aioseo" | null;
}

export interface WpPage {
  id: number;
  type: "page" | "post";
  url: string;
  title: string;
  seoTitle: string | null;
  metaDescription: string | null;
  h1: string | null;
  builder: "elementor" | "gutenberg" | "classic";
  text: string;
  status: string;
}

export interface WpSnapshot {
  id: number;
  post: { post_title: string; post_content: string; post_excerpt: string; post_name: string; post_status: string };
  meta: Record<string, unknown>;
}

export class WordPressClient {
  private base: string;
  private secret: string;

  constructor(private integration: Integration) {
    const creds = decryptJson<{ siteUrl: string; secret: string }>(integration.credentialsEnc);
    if (!creds) throw new Error("WordPress integration has no credentials");
    this.base = creds.siteUrl.replace(/\/$/, "");
    this.secret = creds.secret;
  }

  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const ts = Math.floor(Date.now() / 1000).toString();
    const payload = body === undefined ? "" : JSON.stringify(body);
    const route = `/wp-json/lsa/v1${path}`;
    const sig = hmacSha256(this.secret, `${ts}\n${method}\n${route.split("?")[0]}\n${payload}`);
    const res = await fetch(`${this.base}${route}`, {
      method,
      headers: { "content-type": "application/json", "x-lsa-timestamp": ts, "x-lsa-signature": sig },
      body: method === "POST" ? payload : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) throw new Error(`WordPress connector ${res.status} on ${path}: ${(await res.text()).slice(0, 200)}`);
    return res.json() as Promise<T>;
  }

  status() {
    return this.call<WpStatus>("GET", "/status");
  }
  async listPages(): Promise<WpPage[]> {
    const out: WpPage[] = [];
    for (let page = 1; page < 50; page++) {
      const batch = await this.call<WpPage[]>("GET", `/content?page=${page}`);
      out.push(...batch);
      if (batch.length < 50) break;
    }
    return out;
  }
  updateMeta(id: number, meta: { seoTitle?: string; metaDescription?: string }) {
    return this.call<{ ok: boolean; before: { seoTitle: string | null; metaDescription: string | null } }>("POST", "/meta", { id, ...meta });
  }
  setImageAlt(imageUrl: string, alt: string) {
    return this.call<{ ok: boolean; before: string | null; attachmentId: number }>("POST", "/image-alt", { imageUrl, alt });
  }
  addSchema(id: number, jsonld: unknown) {
    return this.call<{ ok: boolean; before: unknown }>("POST", "/schema", { id, jsonld });
  }
  addInternalLink(id: number, anchor: string, url: string) {
    return this.call<{ ok: boolean; applied: boolean; reason?: string }>("POST", "/internal-link", { id, anchor, url });
  }
  replaceLink(id: number, from: string, to: string) {
    return this.call<{ ok: boolean; replaced: number }>("POST", "/replace-link", { id, from, to });
  }
  createPost(post: { title: string; content: string; slug: string; status: "draft" | "future" | "publish"; date?: string; seoTitle?: string; metaDescription?: string; featuredImageUrl?: string; featuredAlt?: string; schema?: unknown }) {
    return this.call<{ id: number; url: string; status: string }>("POST", "/posts", post);
  }
  snapshot(id: number) {
    return this.call<WpSnapshot>("GET", `/snapshot?id=${id}`);
  }
  restore(snapshot: WpSnapshot) {
    return this.call<{ ok: boolean }>("POST", "/restore", snapshot);
  }
  getPost(id: number) {
    return this.call<WpPage>("GET", `/content/${id}`);
  }
}

export function wordpressClient(integration: Integration | null) {
  if (!integration || integration.mode === "DEMO" || integration.kind !== "WEBSITE_WORDPRESS") return null;
  return new WordPressClient(integration);
}
