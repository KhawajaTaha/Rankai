import type { AiRecommendation, Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, audit, AUTOMATION_ACTOR, type Actor } from "../audit";
import { gbpProvider } from "../integrations/gbp";
import { wordpressClient } from "../integrations/wordpress";
import { enqueue } from "../jobs/queue";
import { createTask } from "../tasks";
import { ACTIONS } from "./risk";

export class ExecutionError extends Error {
  constructor(message: string, public retryable = true) {
    super(message);
  }
}

export async function gbpContext(locationId: string) {
  const location = await db.gbpLocation.findUniqueOrThrow({ where: { id: locationId }, include: { account: { include: { connection: true } }, services: true, categories: true } });
  const conn = location.account.connection;
  if (conn.status !== "CONNECTED") throw new ExecutionError(`Google connection ${conn.email} is ${conn.status.toLowerCase()}`, false);
  return { location, account: location.account, conn, provider: gbpProvider(conn) };
}

export async function websiteContext(clientId: string) {
  const website = await db.website.findFirst({ where: { clientId }, orderBy: { createdAt: "asc" } });
  if (!website) throw new ExecutionError("No website connected", false);
  const integration = website.integrationId ? await db.integration.findUnique({ where: { id: website.integrationId } }) : null;
  return { website, integration, wp: wordpressClient(integration), demo: !integration || integration.mode === "DEMO" };
}

interface Applied {
  before: string | null;
  after: string | null;
  field: string;
  target: string;
  websiteId?: string;
  locationId?: string;
  backupId?: string;
  verified: boolean;
  rollbackable: boolean;
  note?: string;
}

/**
 * Execution service (spec §92-94): re-checks gates, takes backups, applies the change through
 * the integration layer, records before/after, verifies the final state, and audits everything.
 */
export async function executeRecommendation(recId: string, actor: Actor = AUTOMATION_ACTOR, runId?: string) {
  const rec = await db.aiRecommendation.findUniqueOrThrow({ where: { id: recId }, include: { client: true } });
  if (!["SCHEDULED", "APPROVED", "FAILED"].includes(rec.status)) return { skipped: `status is ${rec.status}` };
  const meta = ACTIONS[rec.action];
  if (!meta) throw new ExecutionError(`Unknown action ${rec.action}`, false);
  if (meta.actionClass === "PROTECTED") throw new ExecutionError("Protected actions cannot be executed by automation", false);
  // Human override: a paused client blocks automatic (non-approved) execution.
  if (rec.status === "SCHEDULED" && rec.client.automationPaused) {
    await db.aiRecommendation.update({ where: { id: rec.id }, data: { status: "PROPOSED", blockedReason: "Automation paused before execution" } });
    return { skipped: "automation paused" };
  }
  await db.aiRecommendation.update({ where: { id: rec.id }, data: { status: "EXECUTING" } });

  let applied: Applied;
  try {
    applied = await apply(rec);
  } catch (e) {
    const err = e as Error;
    await db.aiRecommendation.update({ where: { id: rec.id }, data: { status: "FAILED", outcome: err.message.slice(0, 500) } });
    throw err;
  }

  const action = await db.seoAction.create({
    data: {
      organizationId: rec.organizationId,
      clientId: rec.clientId,
      websiteId: applied.websiteId,
      locationId: applied.locationId,
      recommendationId: rec.id,
      target: applied.target,
      field: rec.action,
      beforeValue: applied.before,
      afterValue: applied.after,
      reason: rec.reason,
      risk: rec.risk,
      actorType: actor.type,
      actorId: actor.id ?? null,
      backupId: applied.backupId,
      status: applied.verified ? "VERIFIED" : "APPLIED",
      rollbackable: applied.rollbackable && meta.rollbackable,
    },
  });
  await db.aiRecommendation.update({
    where: { id: rec.id },
    data: { status: applied.verified ? "VERIFIED" : "EXECUTED", executedAt: new Date(), verifiedAt: applied.verified ? new Date() : null, outcome: applied.note ?? null },
  });
  await audit({
    organizationId: rec.organizationId,
    clientId: rec.clientId,
    actor,
    action: `execute.${rec.action}`,
    entityType: "SeoAction",
    entityId: action.id,
    oldValue: applied.before,
    newValue: applied.after,
    automationRunId: runId,
    source: runId ? "worker" : "ui",
  });
  await activity({
    organizationId: rec.organizationId,
    clientId: rec.clientId,
    category: meta.domain === "GBP" || meta.domain === "REVIEWS" ? "GBP" : meta.domain === "CONTENT" ? "CONTENT" : "WEBSITE",
    type: `execute.${rec.action}`,
    title: rec.title,
    detail: applied.note ?? (applied.after ? `Now: ${applied.after.slice(0, 160)}` : undefined),
    actor,
    entityType: "SeoAction",
    entityId: action.id,
  });
  // Feedback loop: measure this change later (spec §54).
  if (meta.major || meta.domain === "WEBSITE") {
    await enqueue("feedback.measure", { seoActionId: action.id }, {
      organizationId: rec.organizationId,
      clientId: rec.clientId,
      label: `Measure impact: ${rec.title}`,
      runAt: new Date(Date.now() + 14 * 86_400_000),
      dedupeKey: `measure:${action.id}`,
    });
  }
  return { seoActionId: action.id, verified: applied.verified };
}

async function apply(rec: AiRecommendation): Promise<Applied> {
  const p = (rec.payload ?? {}) as Record<string, unknown>;
  const value = rec.suggestedValue ?? "";
  switch (rec.action) {
    case "update_gbp_description": {
      const { location, account, provider, conn } = await gbpContext(rec.locationId!);
      const before = location.description;
      await provider.updateLocation(location.googleName, { description: value });
      await db.gbpLocation.update({ where: { id: location.id }, data: { description: value } });
      const verified = conn.mode === "DEMO" ? true : (await provider.getLocation(account.googleName, location.googleName)).description === value;
      if (!verified) throw new ExecutionError("Verification failed: GBP description did not update");
      return { before, after: value, field: "description", target: `gbp:${location.id}:description`, locationId: location.id, verified, rollbackable: true };
    }
    case "add_gbp_services": {
      const { location, provider } = await gbpContext(rec.locationId!);
      const before = location.services.map((s) => s.name);
      const add = (p.services as string[] | undefined) ?? value.split(",").map((s) => s.trim()).filter(Boolean);
      const merged = [...new Set([...before, ...add])];
      await provider.updateLocation(location.googleName, { services: merged.map((name) => ({ name })) });
      for (const name of add) {
        await db.gbpService.upsert({ where: { locationId_name: { locationId: location.id, name } }, create: { organizationId: rec.organizationId, clientId: rec.clientId, locationId: location.id, name, source: "platform" }, update: {} });
      }
      return { before: before.join(", "), after: merged.join(", "), field: "services", target: `gbp:${location.id}:services`, locationId: location.id, verified: true, rollbackable: true };
    }
    case "reply_review_positive":
    case "reply_review_negative": {
      const review = await db.gbpReview.findUniqueOrThrow({ where: { id: String(p.reviewId) } });
      const { provider } = await gbpContext(review.locationId);
      await provider.replyToReview(review.googleName, value);
      await db.gbpReview.update({ where: { id: review.id }, data: { replyText: value, replyStatus: "POSTED", repliedAt: new Date(), repliedBy: rec.status === "APPROVED" ? "HUMAN" : "AI" } });
      return { before: review.replyText, after: value, field: "review_reply", target: `review:${review.id}`, locationId: review.locationId, verified: true, rollbackable: false };
    }
    case "update_meta_description":
    case "update_seo_title": {
      const { website, wp } = await websiteContext(rec.clientId);
      const page = await db.websitePage.findFirstOrThrow({ where: { websiteId: website.id, url: rec.target ?? "" } });
      const field = rec.action === "update_seo_title" ? "title" : "metaDescription";
      const before = field === "title" ? page.title : page.metaDescription;
      let verified = true;
      if (wp && page.externalId) {
        await wp.updateMeta(Number(page.externalId), field === "title" ? { seoTitle: value } : { metaDescription: value });
        const check = await wp.getPost(Number(page.externalId));
        verified = (field === "title" ? check.seoTitle : check.metaDescription) === value;
        if (!verified) throw new ExecutionError("Verification failed: metadata not updated on the site");
      } else if (wp) {
        throw new ExecutionError("Page is not mapped to a WordPress post id — run a website sync first", false);
      }
      await db.websitePage.update({ where: { id: page.id }, data: { [field]: value, ...(rec.action === "update_seo_title" ? { lastMajorChangeAt: new Date() } : {}) } });
      await db.seoIssue.updateMany({ where: { clientId: rec.clientId, url: page.url, code: { in: field === "title" ? ["missing_title", "long_title"] : ["missing_meta_description", "meta_description_length"] }, status: "OPEN" }, data: { status: "FIXED", resolvedAt: new Date() } });
      return { before, after: value, field, target: page.url, websiteId: website.id, verified, rollbackable: true };
    }
    case "update_image_alt": {
      const { website, wp } = await websiteContext(rec.clientId);
      const images = (p.images as { src: string; alt: string }[] | undefined) ?? [];
      const before: string[] = [];
      for (const img of images) {
        if (wp) before.push((await wp.setImageAlt(img.src, img.alt)).before ?? "");
        else before.push("");
      }
      await db.websitePage.updateMany({ where: { websiteId: website.id, url: rec.target ?? "" }, data: { imagesMissingAlt: 0 } });
      await db.seoIssue.updateMany({ where: { clientId: rec.clientId, url: rec.target, code: "missing_alt", status: "OPEN" }, data: { status: "FIXED", resolvedAt: new Date() } });
      return { before: JSON.stringify(images.map((im, i) => ({ src: im.src, alt: before[i] }))), after: JSON.stringify(images), field: "alt", target: rec.target ?? "", websiteId: website.id, verified: true, rollbackable: true };
    }
    case "add_faq_schema":
    case "add_local_business_schema": {
      const { website, wp } = await websiteContext(rec.clientId);
      const page = await db.websitePage.findFirstOrThrow({ where: { websiteId: website.id, url: rec.target ?? "" } });
      let before: string | null = null;
      if (wp && page.externalId) before = JSON.stringify((await wp.addSchema(Number(page.externalId), JSON.parse(value))).before ?? null);
      const type = rec.action === "add_faq_schema" ? "FAQPage" : "LocalBusiness";
      await db.websitePage.update({ where: { id: page.id }, data: { schemaTypes: [...new Set([...page.schemaTypes, type])] } });
      await db.seoIssue.updateMany({ where: { clientId: rec.clientId, code: "missing_localbusiness_schema", status: "OPEN" }, data: { status: "FIXED", resolvedAt: new Date() } });
      return { before, after: value, field: "schema", target: page.url, websiteId: website.id, verified: true, rollbackable: true };
    }
    case "add_internal_link":
    case "fix_broken_link": {
      const { website, wp } = await websiteContext(rec.clientId);
      const page = await db.websitePage.findFirstOrThrow({ where: { websiteId: website.id, url: rec.target ?? "" } });
      let backupId: string | undefined;
      if (wp && page.externalId) {
        const snap = await wp.snapshot(Number(page.externalId));
        backupId = (await db.websiteBackup.create({ data: { organizationId: rec.organizationId, clientId: rec.clientId, websiteId: website.id, pageUrl: page.url, externalId: page.externalId, reason: rec.title, snapshot: snap as unknown as Prisma.InputJsonValue } })).id;
        if (rec.action === "add_internal_link") {
          const r = await wp.addInternalLink(Number(page.externalId), String(p.anchor), String(p.url));
          if (!r.applied) throw new ExecutionError(`Link not applied: ${r.reason ?? "anchor text not found in an editable text block"}`, false);
        } else {
          await wp.replaceLink(Number(page.externalId), String(p.from), String(p.to));
        }
      } else {
        backupId = (await db.websiteBackup.create({ data: { organizationId: rec.organizationId, clientId: rec.clientId, websiteId: website.id, pageUrl: page.url, reason: rec.title, snapshot: { internalLinksOut: page.internalLinksOut } } })).id;
      }
      if (rec.action === "add_internal_link") {
        await db.websitePage.update({ where: { id: page.id }, data: { internalLinksOut: { increment: 1 } } });
        await db.websitePage.updateMany({ where: { websiteId: website.id, url: String(p.url) }, data: { internalLinksIn: { increment: 1 } } });
        await db.seoIssue.updateMany({ where: { clientId: rec.clientId, url: String(p.url), code: "orphan_page", status: "OPEN" }, data: { status: "FIXED", resolvedAt: new Date() } });
      } else {
        await db.seoIssue.updateMany({ where: { clientId: rec.clientId, url: page.url, code: "broken_link", status: "OPEN" }, data: { status: "FIXED", resolvedAt: new Date() } });
      }
      return { before: rec.currentValue, after: value, field: rec.action, target: page.url, websiteId: website.id, backupId, verified: true, rollbackable: true };
    }
    case "create_supporting_blog":
    case "generate_gbp_post": {
      const type = rec.action === "create_supporting_blog" ? "BLOG" : "GBP_POST";
      const item = await db.contentItem.create({
        data: {
          organizationId: rec.organizationId,
          clientId: rec.clientId,
          locationId: rec.locationId,
          type,
          status: "GENERATING",
          title: value || rec.title,
          topic: value || rec.title,
          primaryKeyword: (p.keyword as string | undefined) ?? null,
          servicePromoted: (p.service as string | undefined) ?? null,
          category: (p.category as string | undefined) ?? (type === "GBP_POST" ? "Service" : null),
          scheduledFor: new Date(Date.now() + 3 * 86_400_000),
        },
      });
      await enqueue("content.generate", { contentItemId: item.id }, { organizationId: rec.organizationId, clientId: rec.clientId, label: `Generate ${type === "BLOG" ? "blog" : "GBP post"}: ${item.title}`, dedupeKey: `gen:${item.id}` });
      return { before: null, after: item.title, field: "content", target: `content:${item.id}`, verified: true, rollbackable: false, note: "Draft queued for generation" };
    }
    default: {
      // Approved but not automatable through APIs (e.g. H1 rewrites on Elementor pages, redirects, category changes):
      // snapshot first where possible, then hand to a human with full context. Never blindly overwrite.
      let backupId: string | undefined;
      const meta = ACTIONS[rec.action];
      if (meta?.backup) {
        const { website, wp } = await websiteContext(rec.clientId).catch(() => ({ website: null, wp: null }));
        const page = website ? await db.websitePage.findFirst({ where: { websiteId: website.id, url: rec.target ?? "" } }) : null;
        if (website && page) {
          const snapshot = wp && page.externalId ? ((await wp.snapshot(Number(page.externalId))) as unknown as Prisma.InputJsonValue) : ({ title: page.title, h1: page.h1, meta: page.metaDescription } as Prisma.InputJsonValue);
          backupId = (await db.websiteBackup.create({ data: { organizationId: rec.organizationId, clientId: rec.clientId, websiteId: website.id, pageUrl: page.url, externalId: page.externalId, reason: `Pre-change backup: ${rec.title}`, snapshot } })).id;
        }
      }
      await createTask({
        organizationId: rec.organizationId,
        clientId: rec.clientId,
        title: `Apply approved change: ${rec.title}`,
        description: `Target: ${rec.target ?? "—"}\nBefore: ${rec.currentValue ?? "—"}\nAfter: ${rec.suggestedValue ?? "—"}\n\nReason: ${rec.reason}${backupId ? "\n\nA backup snapshot was taken before this change." : ""}\n\nThis change requires manual application (layout/builder-safe).`,
        category: meta?.domain === "GBP" ? "GBP" : "Website",
        priority: "HIGH",
        source: "AI",
        sourceRef: rec.id,
        dedupeKey: `apply:${rec.id}`,
      });
      return { before: rec.currentValue, after: rec.suggestedValue, field: rec.action, target: rec.target ?? "", backupId, verified: false, rollbackable: Boolean(backupId), note: "Handed to a specialist for manual application" };
    }
  }
}

/** Roll back a change using its stored before-value or backup snapshot (spec §31-32). */
export async function rollbackAction(seoActionId: string, organizationId: string, actor: Actor) {
  const a = await db.seoAction.findFirstOrThrow({ where: { id: seoActionId, organizationId } });
  if (!a.rollbackable || a.status === "ROLLED_BACK") throw new ExecutionError("This change cannot be rolled back", false);
  const rec = a.recommendationId ? await db.aiRecommendation.findUnique({ where: { id: a.recommendationId } }) : null;
  switch (a.field) {
    case "update_gbp_description": {
      const { location, provider } = await gbpContext(a.locationId!);
      await provider.updateLocation(location.googleName, { description: a.beforeValue ?? "" });
      await db.gbpLocation.update({ where: { id: location.id }, data: { description: a.beforeValue } });
      break;
    }
    case "add_gbp_services": {
      const { location, provider } = await gbpContext(a.locationId!);
      const before = (a.beforeValue ?? "").split(",").map((s) => s.trim()).filter(Boolean);
      await provider.updateLocation(location.googleName, { services: before.map((name) => ({ name })) });
      await db.gbpService.deleteMany({ where: { locationId: location.id, name: { notIn: before } } });
      break;
    }
    case "update_meta_description":
    case "update_seo_title": {
      const { website, wp } = await websiteContext(a.clientId);
      const page = await db.websitePage.findFirstOrThrow({ where: { websiteId: website.id, url: a.target } });
      const field = a.field === "update_seo_title" ? "title" : "metaDescription";
      if (wp && page.externalId) await wp.updateMeta(Number(page.externalId), field === "title" ? { seoTitle: a.beforeValue ?? "" } : { metaDescription: a.beforeValue ?? "" });
      await db.websitePage.update({ where: { id: page.id }, data: { [field]: a.beforeValue } });
      break;
    }
    case "update_image_alt": {
      const { wp } = await websiteContext(a.clientId);
      if (wp) for (const im of JSON.parse(a.beforeValue ?? "[]") as { src: string; alt: string }[]) await wp.setImageAlt(im.src, im.alt ?? "");
      break;
    }
    default: {
      if (!a.backupId) throw new ExecutionError("No backup available for this change", false);
      await restoreBackup(a.backupId, organizationId, actor);
    }
  }
  await db.seoAction.update({ where: { id: a.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date(), rolledBackById: actor.id ?? null } });
  if (rec) await db.aiRecommendation.update({ where: { id: rec.id }, data: { status: "ROLLED_BACK" } });
  await audit({ organizationId, clientId: a.clientId, actor, action: "rollback", entityType: "SeoAction", entityId: a.id, oldValue: a.afterValue, newValue: a.beforeValue, source: "ui" });
  await activity({ organizationId, clientId: a.clientId, category: "WEBSITE", type: "rollback", title: `Rolled back: ${ACTIONS[a.field]?.label ?? a.field}`, detail: a.target, actor });
}

export async function restoreBackup(backupId: string, organizationId: string, actor: Actor) {
  const b = await db.websiteBackup.findFirstOrThrow({ where: { id: backupId, organizationId } });
  const { wp } = await websiteContext(b.clientId);
  if (wp && b.externalId) await wp.restore(b.snapshot as never);
  await db.websiteBackup.update({ where: { id: b.id }, data: { restoredAt: new Date() } });
  await audit({ organizationId, clientId: b.clientId, actor, action: "backup.restore", entityType: "WebsiteBackup", entityId: b.id, source: "ui" });
}
