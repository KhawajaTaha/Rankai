"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { assertClientAccess } from "@/lib/tenancy";
import { activity, audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { checkClaims } from "@/lib/ai/safety";

async function loadItem(ctxOrg: string, id: string) {
  return db.contentItem.findFirstOrThrow({ where: { id, organizationId: ctxOrg } });
}

export async function rescheduleContentAction(id: string, isoDate: string): Promise<ActionResult> {
  return guarded(["publish_content"], async (ctx) => {
    const item = await loadItem(ctx.orgId, id);
    await assertClientAccess(ctx, item.clientId);
    if (item.status === "PUBLISHED") throw new Error("Already published");
    const day = new Date(`${isoDate}T00:00:00`);
    if (Number.isNaN(day.getTime())) throw new Error("Invalid date");
    const when = new Date(day);
    const prev = item.scheduledFor ?? new Date();
    when.setHours(prev.getHours(), prev.getMinutes(), 0, 0);
    await db.contentItem.update({ where: { id }, data: { scheduledFor: when } });
    if (item.status === "SCHEDULED") {
      await db.automationRun.updateMany({ where: { type: "content.publish", status: { in: ["QUEUED", "RETRYING"] }, payload: { path: ["contentItemId"], equals: id } }, data: { status: "CANCELLED", completedAt: new Date() } });
      await enqueue("content.publish", { contentItemId: id }, { organizationId: ctx.orgId, clientId: item.clientId, label: `Publish: ${item.title}`, runAt: when, dedupeKey: `publish:${id}:${when.getTime()}` });
    }
    await audit({ organizationId: ctx.orgId, clientId: item.clientId, actor: actorOf(ctx), action: "content.reschedule", entityType: "ContentItem", entityId: id, oldValue: item.scheduledFor, newValue: when, source: "ui" });
    revalidatePath("/content");
    revalidatePath(`/clients/${item.clientId}`, "layout");
    return { ok: true };
  });
}

export async function updateContentAction(id: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_content"], async (ctx) => {
    const item = await loadItem(ctx.orgId, id);
    await assertClientAccess(ctx, item.clientId);
    if (item.status === "PUBLISHED") throw new Error("Published content can't be edited here");
    const body = z.string().min(10).max(60000).parse(fd.str(f, "body"));
    const k = await db.clientKnowledge.findUnique({ where: { clientId: item.clientId } });
    const safety = checkClaims(body, { wordsToAvoid: k?.wordsToAvoid, doNotPromote: k?.doNotPromote });
    await db.contentItem.update({ where: { id }, data: { title: fd.str(f, "title") || item.title, body, cta: fd.opt(f, "cta") ?? item.cta, scheduledFor: fd.date(f, "scheduledFor") ?? item.scheduledFor, generatedBy: "HUMAN" } });
    await audit({ organizationId: ctx.orgId, clientId: item.clientId, actor: actorOf(ctx), action: "content.edit", entityType: "ContentItem", entityId: id, oldValue: item.body, newValue: body, source: "ui" });
    revalidatePath(`/content/${id}`);
    return { ok: true, message: safety.safe ? "Saved." : `Saved — review flagged: ${safety.issues.join("; ")}` };
  });
}

export async function contentOpAction(id: string, op: "approve" | "publish" | "pause" | "resume" | "regenerate" | "reject"): Promise<ActionResult> {
  const perm = op === "regenerate" ? "create_content" : op === "approve" || op === "reject" ? "approve_content" : "publish_content";
  return guarded([perm], async (ctx) => {
    const item = await loadItem(ctx.orgId, id);
    await assertClientAccess(ctx, item.clientId);
    switch (op) {
      case "approve": {
        const when = item.scheduledFor && item.scheduledFor > new Date() ? item.scheduledFor : new Date();
        await db.contentItem.update({ where: { id }, data: { status: "SCHEDULED", scheduledFor: when } });
        await db.approval.updateMany({ where: { contentItemId: id, status: "PENDING" }, data: { status: "APPROVED", decidedAt: new Date(), decidedById: ctx.memberId } });
        if (item.imageId) await db.mediaAsset.update({ where: { id: item.imageId }, data: { status: "APPROVED", approvedForGbp: item.type === "GBP_POST" ? true : undefined, approvedForBlog: item.type === "BLOG" ? true : undefined } });
        await enqueue("content.publish", { contentItemId: id }, { organizationId: ctx.orgId, clientId: item.clientId, label: `Publish: ${item.title}`, runAt: when, dedupeKey: `publish:${id}:${when.getTime()}` });
        break;
      }
      case "publish":
        await db.contentItem.update({ where: { id }, data: { status: "SCHEDULED", scheduledFor: new Date() } });
        await enqueue("content.publish", { contentItemId: id }, { organizationId: ctx.orgId, clientId: item.clientId, label: `Publish now: ${item.title}`, triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 1 });
        break;
      case "pause":
        await db.contentItem.update({ where: { id }, data: { status: "PAUSED" } });
        break;
      case "resume":
        await db.contentItem.update({ where: { id }, data: { status: item.body ? "NEEDS_APPROVAL" : "IDEA" } });
        break;
      case "reject":
        await db.contentItem.update({ where: { id }, data: { status: "REJECTED" } });
        await db.approval.updateMany({ where: { contentItemId: id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: ctx.memberId } });
        break;
      case "regenerate":
        await db.approval.updateMany({ where: { contentItemId: id, status: "PENDING" }, data: { status: "EXPIRED" } });
        await db.contentItem.update({ where: { id }, data: { status: "DRAFT", imageId: null } });
        await enqueue("content.generate", { contentItemId: id }, { organizationId: ctx.orgId, clientId: item.clientId, label: `Regenerate: ${item.title}`, triggeredBy: "HUMAN", priority: 2 });
        break;
    }
    await audit({ organizationId: ctx.orgId, clientId: item.clientId, actor: actorOf(ctx), action: `content.${op}`, entityType: "ContentItem", entityId: id, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId: item.clientId, category: "CONTENT", type: `content.${op}`, title: `${op.charAt(0).toUpperCase() + op.slice(1)}: ${item.title}`, actor: actorOf(ctx) });
    revalidatePath("/content");
    revalidatePath(`/content/${id}`);
    revalidatePath(`/clients/${item.clientId}`, "layout");
    return { ok: true, message: `Done: ${op}` };
  });
}
