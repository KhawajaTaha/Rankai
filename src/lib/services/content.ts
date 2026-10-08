import type { ContentItem, Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, AI_ACTOR, AUTOMATION_ACTOR, type Actor } from "../audit";
import { loadBrain } from "../ai/brain";
import { generateBlog, generateGbpPost, isRepetitive, pickService } from "../ai/generators";
import { selectOrGenerateImage } from "../images/generate";
import { gbpProvider } from "../integrations/gbp";
import { wordpressClient } from "../integrations/wordpress";
import { enqueue } from "../jobs/queue";
import { addDays, normalizeTopic, startOfDay } from "../utils";
import { env } from "../env";

/**
 * Smart content calendar (spec §24): fill the next N weeks with GBP posts on the client's
 * preferred days/time and blogs on blog days, rotating categories and services.
 */
export async function planCalendar(clientId: string, weeks = 4) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { automation: true, consent: true, locations: { orderBy: { assignedAt: "asc" }, select: { id: true } } } });
  const s = client.automation;
  if (!s || client.automationPaused || ["OFFBOARDING", "ARCHIVED", "PAUSED"].includes(client.status)) return { planned: 0 };
  const brain = await loadBrain(clientId);
  const horizon = addDays(startOfDay(), weeks * 7);
  const existing = await db.contentItem.findMany({ where: { clientId, scheduledFor: { gte: startOfDay(), lte: horizon }, status: { notIn: ["REJECTED"] } }, select: { type: true, scheduledFor: true, locationId: true } });
  const taken = new Set(existing.map((e) => `${e.type}:${e.locationId ?? ""}:${e.scheduledFor?.toISOString().slice(0, 10)}`));
  const [hh, mm] = s.postTime.split(":").map(Number) as [number, number];
  let planned = 0;
  const cats = s.contentCategories.length ? s.contentCategories : ["Service", "Educational"];
  let catIdx = brain.recentContent.filter((c) => c.type === "GBP_POST").length;
  const servicesUsed: string[] = [];

  // Multi-location clients: each GBP location gets its own posting cadence.
  for (const loc of s.gbpPostingEnabled && s.postsPerWeek > 0 ? client.locations : []) {
    for (let d = 1; d <= weeks * 7; d++) {
      const day = addDays(startOfDay(), d);
      if (!s.postDays.includes(day.getDay())) continue;
      const weekStart = addDays(day, -((day.getDay() + 6) % 7));
      const inWeek = existing.filter((e) => e.type === "GBP_POST" && (e.locationId ?? loc.id) === loc.id && e.scheduledFor && e.scheduledFor >= weekStart && e.scheduledFor < addDays(weekStart, 7)).length;
      if (inWeek >= s.postsPerWeek) continue;
      const key = `GBP_POST:${loc.id}:${day.toISOString().slice(0, 10)}`;
      if (taken.has(key)) continue;
      const when = new Date(day);
      when.setHours(hh, mm, 0, 0);
      const category = cats[catIdx++ % cats.length]!;
      const service = pickService({ ...brain, recentContent: [...brain.recentContent, ...servicesUsed.map((sv) => ({ servicePromoted: sv, createdAt: new Date() }) as never)] });
      servicesUsed.push(service);
      await db.contentItem.create({ data: { organizationId: client.organizationId, clientId, locationId: loc.id, type: "GBP_POST", status: "IDEA", title: `${category} post: ${service}`, category, servicePromoted: service, scheduledFor: when, generatedBy: "AUTOMATION" } });
      existing.push({ type: "GBP_POST", scheduledFor: when, locationId: loc.id });
      taken.add(key);
      planned++;
    }
  }
  if (s.blogsEnabled && s.blogsPerMonth > 0 && client.consent?.blogs) {
    const perWeek = s.blogsPerMonth / 4.3;
    let budget = Math.max(0, Math.round(perWeek * weeks) - existing.filter((e) => e.type === "BLOG").length);
    for (let d = 3; d <= weeks * 7 && budget > 0; d++) {
      const day = addDays(startOfDay(), d);
      if (!(s.blogDays.length ? s.blogDays : [2]).includes(day.getDay())) continue;
      if (taken.has(`BLOG::${day.toISOString().slice(0, 10)}`)) continue;
      if (d < 7 * (planned ? 1 : 0)) continue;
      const when = new Date(day);
      when.setHours(9, 0, 0, 0);
      const service = s.blogTargetServices[0] ?? pickService(brain);
      await db.contentItem.create({ data: { organizationId: client.organizationId, clientId, type: "BLOG", status: "IDEA", title: `Blog: ${service}`, servicePromoted: service, scheduledFor: when, generatedBy: "AUTOMATION" } });
      taken.add(`BLOG::${day.toISOString().slice(0, 10)}`);
      budget--;
      planned++;
      d += Math.floor(7 / Math.max(perWeek, 0.25)) - 1;
    }
  }
  if (planned) await activity({ organizationId: client.organizationId, clientId, category: "CONTENT", type: "calendar.planned", title: `Content calendar populated with ${planned} item(s)`, actor: AUTOMATION_ACTOR });
  return { planned };
}

/** Generate copy + image for a content item and route it per approval/publish settings. */
export async function generateContent(itemId: string, actor: Actor = AI_ACTOR) {
  const item = await db.contentItem.findUniqueOrThrow({ where: { id: itemId }, include: { client: { include: { automation: true, consent: true } } } });
  if (["PUBLISHED", "PUBLISHING", "REJECTED"].includes(item.status)) return { skipped: item.status };
  const client = item.client;
  const s = client.automation;
  let brain = await loadBrain(client.id);
  if (item.locationId) {
    // Multi-location: write for the specific location's city.
    const loc = await db.gbpLocation.findUnique({ where: { id: item.locationId }, select: { address: true } });
    const city = locationCity(loc?.address);
    if (city) brain = { ...brain, city };
  }
  await db.contentItem.update({ where: { id: item.id }, data: { status: "GENERATING", attempts: { increment: 1 } } });

  let data: Prisma.ContentItemUpdateInput;
  let safetyIssues: string[] = [];
  let imageNeedsApproval = false;
  if (item.type === "GBP_POST") {
    let post = await generateGbpPost(brain, { category: item.category ?? "Service", service: item.servicePromoted });
    // Content memory guard: regenerate once if too similar to existing content.
    if (isRepetitive(brain, "GBP_POST", post.title, 0.75)) post = await generateGbpPost(brain, { category: item.category ?? "Service", service: item.servicePromoted, attempt: 1 });
    safetyIssues = post.safetyIssues;
    data = { title: post.title, topic: post.title, body: post.body, cta: post.cta, servicePromoted: post.servicePromoted, keywords: post.keywords, primaryKeyword: post.keywords[0], fingerprint: normalizeTopic(post.title), aiModel: post.mode === "LIVE" ? env.aiModel : "demo-generator", ctaUrl: client.website };
    if (s?.autoGenerateImage !== false && !item.imageId) {
      const img = await selectOrGenerateImage({
        organizationId: client.organizationId, clientId: client.id, purpose: "GBP_POST", concept: post.imageConcept, keywords: [post.servicePromoted, ...post.keywords],
        mode: s?.aiImagesGbp ?? "OFF", consentAiImages: client.consent?.aiImages ?? false, preferRealPhotos: s?.preferRealPhotos ?? true,
      });
      if (img.media) {
        data.image = { connect: { id: img.media.id } };
        await db.mediaAsset.update({ where: { id: img.media.id }, data: { usageCount: { increment: 1 }, lastUsedAt: new Date() } });
      }
      imageNeedsApproval = img.source === "AI" && img.needsApproval;
    }
  } else if (item.type === "BLOG") {
    const site = await db.website.findFirst({ where: { clientId: client.id }, include: { pages: { where: { statusCode: 200 }, take: 40, select: { url: true, title: true } } } });
    const blog = await generateBlog(brain, { topic: item.topic, service: item.servicePromoted, pages: site?.pages ?? [], minWords: s?.blogMinWords });
    safetyIssues = blog.safetyIssues;
    data = {
      title: blog.h1, topic: blog.topic, body: blog.contentMarkdown, primaryKeyword: blog.primaryKeyword, keywords: blog.secondaryKeywords, cta: blog.cta, fingerprint: normalizeTopic(blog.topic),
      seo: { slug: blog.slug, seoTitle: blog.seoTitle, metaDescription: blog.metaDescription, searchIntent: blog.searchIntent, outline: blog.outline, faqs: blog.faqs, internalLinks: blog.internalLinks, externalReferences: blog.externalReferences, schema: blog.schema, wordCount: blog.wordCount, featuredImage: blog.featuredImage } as Prisma.InputJsonValue,
      aiModel: blog.mode === "LIVE" ? env.aiModel : "demo-generator",
    };
    if (s?.blogFeaturedImage !== false && !item.imageId) {
      const img = await selectOrGenerateImage({
        organizationId: client.organizationId, clientId: client.id, purpose: "BLOG", concept: blog.featuredImage.concept, keywords: [blog.primaryKeyword],
        mode: s?.aiImagesBlog ?? "OFF", consentAiImages: client.consent?.aiImages ?? false, preferRealPhotos: s?.preferRealPhotos ?? true,
      });
      if (img.media) {
        data.image = { connect: { id: img.media.id } };
        await db.mediaAsset.update({ where: { id: img.media.id }, data: { altText: img.source === "AI" ? blog.featuredImage.altText : undefined, title: blog.featuredImage.title, usageCount: { increment: 1 }, lastUsedAt: new Date() } });
      }
      imageNeedsApproval = img.source === "AI" && img.needsApproval;
    }
  } else {
    data = {};
  }

  const requireApproval =
    item.type === "GBP_POST" ? s?.postsRequireApproval !== false : item.type === "BLOG" ? s?.blogRequireApproval !== false : true;
  const autoPublish =
    (item.type === "GBP_POST" ? s?.autoPublishPosts && client.consent?.gbpAutoPosting : item.type === "BLOG" ? s?.blogAutoPublish && client.consent?.blogs : false) && client.consent?.autoPublishing;
  const level = s?.level ?? "ASSIST";
  const needsHuman = requireApproval || safetyIssues.length > 0 || imageNeedsApproval || level === "ASSIST" || level === "MONITOR_ONLY" || client.automationPaused || !autoPublish;

  const status = needsHuman ? "NEEDS_APPROVAL" : "SCHEDULED";
  const updated = await db.contentItem.update({ where: { id: item.id }, data: { ...data, status, generatedBy: "AI", failureReason: null } });
  if (needsHuman) {
    const reasons = [
      requireApproval && "Client requires approval",
      safetyIssues.length && `Safety: ${safetyIssues.join("; ")}`,
      imageNeedsApproval && "AI image requires approval",
      !autoPublish && "Auto-publish not enabled/consented",
      client.automationPaused && "Automation paused",
    ].filter(Boolean);
    await db.approval.create({
      data: {
        organizationId: client.organizationId, clientId: client.id, category: imageNeedsApproval && item.type === "GBP_POST" ? "IMAGES" : "CONTENT",
        title: `${item.type === "BLOG" ? "Blog" : "GBP post"}: ${updated.title}`, description: reasons.join(" · "), afterValue: updated.body, reason: `Scheduled for ${updated.scheduledFor?.toDateString() ?? "next available slot"}`,
        risk: safetyIssues.length ? "MEDIUM" : "LOW", confidence: safetyIssues.length ? 0.7 : 0.9, contentItemId: item.id, requiresClient: requireApproval,
      },
    });
  } else {
    const when = updated.scheduledFor && updated.scheduledFor > new Date() ? updated.scheduledFor : new Date();
    await enqueue("content.publish", { contentItemId: item.id }, { organizationId: client.organizationId, clientId: client.id, label: `Publish: ${updated.title}`, runAt: when, dedupeKey: `publish:${item.id}:${when.getTime()}` });
  }
  await activity({ organizationId: client.organizationId, clientId: client.id, category: "CONTENT", type: "content.generated", title: `${item.type === "BLOG" ? "Blog" : "GBP post"} generated: ${updated.title}`, detail: needsHuman ? "Awaiting approval" : "Scheduled for auto-publish", actor });
  if (updated.imageId) await activity({ organizationId: client.organizationId, clientId: client.id, category: "AI", type: "image.attached", title: "Image attached to content", actor });
  return { status };
}

/** Publish to GBP / WordPress, then verify the final state (spec §94). Throws to trigger retries. */
export async function publishContent(itemId: string, actor: Actor = AUTOMATION_ACTOR) {
  const item = await db.contentItem.findUniqueOrThrow({ where: { id: itemId }, include: { image: true, client: true } });
  if (item.status === "PUBLISHED") return { skipped: "already published" };
  if (!["SCHEDULED", "APPROVED", "FAILED", "PUBLISHING"].includes(item.status)) return { skipped: `status ${item.status}` };
  if (item.client.automationPaused && actor.type !== "HUMAN") return { skipped: "automation paused" };
  await db.contentItem.update({ where: { id: item.id }, data: { status: "PUBLISHING", attempts: { increment: 1 } } });
  try {
    const result = item.type === "GBP_POST" ? await publishGbpPost(item) : item.type === "BLOG" ? await publishBlog(item) : { externalId: null, externalUrl: null };
    await db.contentItem.update({ where: { id: item.id }, data: { status: "PUBLISHED", publishedAt: new Date(), externalId: result.externalId, externalUrl: result.externalUrl, failureReason: null } });
    await activity({ organizationId: item.organizationId, clientId: item.clientId, category: "CONTENT", type: `${item.type.toLowerCase()}.published`, title: `${item.type === "BLOG" ? "Blog" : "GBP post"} published: ${item.title}`, actor });
    return result;
  } catch (e) {
    await db.contentItem.update({ where: { id: item.id }, data: { status: "FAILED", failureReason: (e as Error).message.slice(0, 500) } });
    throw e;
  }
}

async function publishGbpPost(item: ContentItem & { image: { url: string } | null }) {
  const loc = item.locationId
    ? await db.gbpLocation.findUniqueOrThrow({ where: { id: item.locationId }, include: { account: { include: { connection: true } } } })
    : await db.gbpLocation.findFirstOrThrow({ where: { clientId: item.clientId }, include: { account: { include: { connection: true } } } });
  if (loc.account.connection.status !== "CONNECTED") throw new Error(`Google connection is ${loc.account.connection.status}`);
  const provider = gbpProvider(loc.account.connection);
  const mediaUrl = item.image ? new URL(item.image.url, env.appUrl).toString() : undefined;
  const created = await provider.createPost(loc.account.googleName, loc.googleName, { summary: item.body ?? item.title, ctaType: item.cta ?? undefined, ctaUrl: item.ctaUrl ?? undefined, mediaUrl });
  // Verify the post exists on Google before marking it complete.
  const verify = await provider.getPost(created.name);
  if (!verify) throw new Error("Post was accepted but could not be verified on Google");
  await db.gbpPost.create({ data: { organizationId: item.organizationId, clientId: item.clientId, locationId: loc.id, googleName: created.name, contentItemId: item.id, summary: item.body ?? item.title, ctaType: item.cta, ctaUrl: item.ctaUrl, mediaUrl: item.image?.url, publishedAt: new Date(), verifiedAt: new Date(), state: verify.state } });
  return { externalId: created.name, externalUrl: null as string | null };
}

async function publishBlog(item: ContentItem & { image: { url: string; altText?: string | null } | null }) {
  const website = await db.website.findFirst({ where: { clientId: item.clientId } });
  const integration = website?.integrationId ? await db.integration.findUnique({ where: { id: website.integrationId } }) : null;
  const wp = wordpressClient(integration);
  const seo = (item.seo ?? {}) as { slug?: string; seoTitle?: string; metaDescription?: string; schema?: unknown; featuredImage?: { altText?: string } };
  if (!wp) {
    if (!integration) throw new Error("No website connector configured — connect the WordPress plugin to publish blogs");
    // Demo-mode integration: record a demo URL so the full workflow is exercisable.
    return { externalId: `demo-${item.id}`, externalUrl: `${website!.url.replace(/\/$/, "")}/blog/${seo.slug ?? item.id}/` };
  }
  const html = markdownToHtml(item.body ?? "");
  const post = await wp.createPost({
    title: item.title, content: html, slug: seo.slug ?? item.id, status: "publish", seoTitle: seo.seoTitle, metaDescription: seo.metaDescription,
    featuredImageUrl: item.image ? new URL(item.image.url, env.appUrl).toString() : undefined, featuredAlt: seo.featuredImage?.altText, schema: seo.schema,
  });
  const check = await wp.getPost(post.id);
  if (!check || !["publish", "future"].includes(check.status)) throw new Error("Blog was created but verification failed");
  return { externalId: String(post.id), externalUrl: post.url };
}

/** "120 Main St, Thunder Bay, ON" → "Thunder Bay". */
export function locationCity(address: string | null | undefined) {
  const parts = (address ?? "").split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1]!;
  return /^[A-Z]{2}( [A-Z0-9 ]+)?$/.test(last) && parts.length >= 3 ? parts[parts.length - 2]! : last;
}

/** Minimal, safe Markdown → HTML for publishing (headings, paragraphs, lists, links, bold/italic). */
export function markdownToHtml(md: string) {
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const inline = (s: string) =>
    esc(s)
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*)\)/g, '<a href="$2">$1</a>');
  const out: string[] = [];
  let list = false;
  for (const line of md.split("\n")) {
    const l = line.trimEnd();
    const h = /^(#{1,6})\s+(.*)$/.exec(l);
    const li = /^[-*]\s+(.*)$/.exec(l);
    if (!li && list) {
      out.push("</ul>");
      list = false;
    }
    if (h) out.push(`<h${h[1]!.length}>${inline(h[2]!)}</h${h[1]!.length}>`);
    else if (li) {
      if (!list) out.push("<ul>");
      list = true;
      out.push(`<li>${inline(li[1]!)}</li>`);
    } else if (l.trim()) out.push(`<p>${inline(l)}</p>`);
  }
  if (list) out.push("</ul>");
  return out.join("\n");
}

/** Generate items whose slot is approaching (lead time so approvals can happen). */
export async function generateDueContent(clientId: string, leadDays = 5) {
  const due = await db.contentItem.findMany({ where: { clientId, status: "IDEA", scheduledFor: { lte: addDays(new Date(), leadDays) } }, orderBy: { scheduledFor: "asc" }, take: 6 });
  for (const d of due) await enqueue("content.generate", { contentItemId: d.id }, { organizationId: d.organizationId, clientId, label: `Generate: ${d.title}`, dedupeKey: `gen:${d.id}` });
  return due.length;
}
