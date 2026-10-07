"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { assertClientAccess, clientScopeFilter } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { decideApproval } from "@/lib/engine/recommendations";
import { restoreBackup, rollbackAction as rollback } from "@/lib/engine/executor";
import { cancelRun, enqueue, retryRun } from "@/lib/jobs/queue";
import { ACTIONS } from "@/lib/engine/risk";
import { processMentions } from "@/lib/services/support";
import { scanClients } from "@/lib/services/watchdog";
import { askAgencyAssistant } from "@/lib/services/assistant";
import { accessibleClientIds } from "@/lib/tenancy";

// ───────── Approvals (spec §57, §68) ─────────
export async function decideApprovalAction(approvalId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["approve_content"], async (ctx) => {
    const a = await db.approval.findFirstOrThrow({ where: { id: approvalId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, a.clientId);
    const decision = fd.str(f, "decision") as "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
    if (!["APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(decision)) throw new Error("Invalid decision");
    await decideApproval({ approvalId, organizationId: ctx.orgId, decision, actor: actorOf(ctx), editedValue: fd.opt(f, "edited"), note: fd.opt(f, "note"), scheduleFor: fd.date(f, "scheduleFor") });
    if (fd.opt(f, "note")) await processMentions(actorOf(ctx), fd.str(f, "note"), { clientId: a.clientId, entityType: "Approval", entityId: a.id, link: `/approvals?client=${a.clientId}` });
    revalidatePath("/approvals");
    revalidatePath(`/clients/${a.clientId}`, "layout");
    return { ok: true, message: decision === "APPROVED" ? "Approved — execution queued." : decision === "REJECTED" ? "Rejected." : "Changes requested." };
  });
}

export async function approveAllSafeAction(clientId?: string): Promise<ActionResult> {
  return guarded(["approve_content"], async (ctx) => {
    const scope = await clientScopeFilter(ctx);
    const pending = await db.approval.findMany({ where: { ...scope, ...(clientId ? { clientId } : {}), status: "PENDING", risk: "LOW", requiresClient: false }, include: { recommendation: true } });
    let n = 0;
    for (const a of pending) {
      // "Safe" = low risk and either auto-safe class or plain content/image approvals.
      if (a.recommendation && ACTIONS[a.recommendation.action]?.actionClass !== "AUTO_SAFE") continue;
      await decideApproval({ approvalId: a.id, organizationId: ctx.orgId, decision: "APPROVED", actor: actorOf(ctx), note: "Approve All Safe Actions" });
      n++;
    }
    revalidatePath("/approvals");
    return { ok: true, message: `${n} safe action(s) approved.` };
  });
}

// ───────── Changes, rollback, backups ─────────
export async function rollbackChangeAction(seoActionId: string): Promise<ActionResult> {
  return guarded(["rollback_changes"], async (ctx) => {
    const a = await db.seoAction.findFirstOrThrow({ where: { id: seoActionId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, a.clientId);
    await rollback(seoActionId, ctx.orgId, actorOf(ctx));
    revalidatePath(`/clients/${a.clientId}`, "layout");
    return { ok: true, message: "Rolled back." };
  });
}

export async function restoreBackupAction(backupId: string): Promise<ActionResult> {
  return guarded(["rollback_changes"], async (ctx) => {
    const b = await db.websiteBackup.findFirstOrThrow({ where: { id: backupId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, b.clientId);
    await restoreBackup(backupId, ctx.orgId, actorOf(ctx));
    revalidatePath(`/clients/${b.clientId}`, "layout");
    return { ok: true, message: "Backup restored." };
  });
}

export async function setIssueStatusAction(issueId: string, status: "OPEN" | "IGNORED" | "FIXED"): Promise<ActionResult> {
  return guarded(["manage_website"], async (ctx) => {
    const i = await db.seoIssue.findFirstOrThrow({ where: { id: issueId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, i.clientId);
    await db.seoIssue.update({ where: { id: i.id }, data: { status, resolvedAt: status === "OPEN" ? null : new Date() } });
    await audit({ organizationId: ctx.orgId, clientId: i.clientId, actor: actorOf(ctx), action: `issue.${status.toLowerCase()}`, entityType: "SeoIssue", entityId: i.id, source: "ui" });
    revalidatePath(`/clients/${i.clientId}`, "layout");
  });
}

export async function recommendationAction(recId: string, op: "execute" | "dismiss"): Promise<ActionResult> {
  return guarded(["approve_content"], async (ctx) => {
    const r = await db.aiRecommendation.findFirstOrThrow({ where: { id: recId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, r.clientId);
    if (op === "dismiss") {
      await db.aiRecommendation.update({ where: { id: r.id }, data: { status: "DISMISSED" } });
      await db.approval.updateMany({ where: { recommendationId: r.id, status: "PENDING" }, data: { status: "REJECTED", decidedAt: new Date(), decidedById: ctx.memberId } });
    } else {
      if (ACTIONS[r.action]?.actionClass === "PROTECTED") throw new Error("Protected actions are manual only");
      await db.aiRecommendation.update({ where: { id: r.id }, data: { status: "APPROVED" } });
      await enqueue("recommendation.execute", { recommendationId: r.id }, { organizationId: ctx.orgId, clientId: r.clientId, label: r.title, triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 2 });
    }
    await audit({ organizationId: ctx.orgId, clientId: r.clientId, actor: actorOf(ctx), action: `recommendation.${op}`, entityType: "AiRecommendation", entityId: r.id, source: "ui" });
    revalidatePath(`/clients/${r.clientId}`, "layout");
    return { ok: true, message: op === "execute" ? "Queued for execution" : "Dismissed" };
  });
}

// ───────── Tasks ─────────
export async function setTaskStatusAction(taskId: string, status: string): Promise<ActionResult> {
  return guarded([], async (ctx) => {
    const t = await db.task.findFirstOrThrow({ where: { id: taskId, organizationId: ctx.orgId } });
    if (t.clientId) await assertClientAccess(ctx, t.clientId);
    if (t.assignedToId !== ctx.memberId && !ctx.can("create_tasks")) throw new Error("Not your task");
    const valid = ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "WAITING_FOR_APPROVAL", "BLOCKED", "COMPLETED", "CANCELLED"];
    if (!valid.includes(status)) throw new Error("Invalid status");
    if (status === "COMPLETED" && t.dependsOnId) {
      const dep = await db.task.findUnique({ where: { id: t.dependsOnId } });
      if (dep && dep.status !== "COMPLETED") throw new Error(`Blocked by "${dep.title}"`);
    }
    await db.task.update({ where: { id: t.id }, data: { status: status as "OPEN", completedAt: status === "COMPLETED" ? new Date() : null } });
    if (status === "COMPLETED") await db.followUp.updateMany({ where: { taskId: t.id, completedAt: null }, data: { completedAt: new Date() } });
    await audit({ organizationId: ctx.orgId, clientId: t.clientId, actor: actorOf(ctx), action: "task.status", entityType: "Task", entityId: t.id, oldValue: t.status, newValue: status, source: "ui" });
    revalidatePath("/tasks");
    if (t.clientId) revalidatePath(`/clients/${t.clientId}`, "layout");
  });
}

export async function reassignTaskAction(taskId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_tasks"], async (ctx) => {
    const t = await db.task.findFirstOrThrow({ where: { id: taskId, organizationId: ctx.orgId } });
    const memberId = fd.opt(f, "assignedToId");
    if (memberId && !(await db.organizationUser.findFirst({ where: { id: memberId, organizationId: ctx.orgId } }))) throw new Error("Invalid member");
    await db.task.update({ where: { id: t.id }, data: { assignedToId: memberId, priority: (fd.str(f, "priority") || t.priority) as "NORMAL", dueAt: fd.date(f, "dueAt") ?? t.dueAt } });
    revalidatePath("/tasks");
    return { ok: true, message: "Updated" };
  });
}

export async function commentTaskAction(taskId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded([], async (ctx) => {
    const t = await db.task.findFirstOrThrow({ where: { id: taskId, organizationId: ctx.orgId } });
    if (t.clientId) await assertClientAccess(ctx, t.clientId);
    const body = fd.str(f, "body");
    if (body.length < 1) throw new Error("Write a comment");
    const mentions = await processMentions(actorOf(ctx), body, { clientId: t.clientId, entityType: "Task", entityId: t.id, link: `/tasks?task=${t.id}` });
    await db.taskComment.create({ data: { organizationId: ctx.orgId, taskId: t.id, authorId: ctx.memberId, body, mentions } });
    revalidatePath("/tasks");
    return { ok: true };
  });
}

// ───────── Alerts & notifications ─────────
export async function alertAction(alertId: string, status: "ACKNOWLEDGED" | "RESOLVED"): Promise<ActionResult> {
  return guarded([], async (ctx) => {
    const a = await db.alert.findFirstOrThrow({ where: { id: alertId, organizationId: ctx.orgId } });
    if (a.clientId) await assertClientAccess(ctx, a.clientId);
    await db.alert.update({ where: { id: a.id }, data: { status, acknowledgedById: ctx.memberId, resolvedAt: status === "RESOLVED" ? new Date() : null } });
    await audit({ organizationId: ctx.orgId, clientId: a.clientId, actor: actorOf(ctx), action: `alert.${status.toLowerCase()}`, entityType: "Alert", entityId: a.id, source: "ui" });
    revalidatePath("/alerts");
  });
}

export async function markNotificationsReadAction(): Promise<ActionResult> {
  return guarded([], async (ctx) => {
    await db.notification.updateMany({ where: { organizationId: ctx.orgId, recipientId: ctx.memberId, readAt: null }, data: { readAt: new Date() } });
    await db.mention.updateMany({ where: { organizationId: ctx.orgId, mentionedId: ctx.memberId, readAt: null }, data: { readAt: new Date() } });
    revalidatePath("/notifications");
  });
}

// ───────── Automation runs (spec §71, §95) ─────────
export async function runControlAction(runId: string, op: "retry" | "cancel"): Promise<ActionResult> {
  return guarded(["view_command_center"], async (ctx) => {
    const r = await db.automationRun.findFirstOrThrow({ where: { id: runId, organizationId: ctx.orgId } });
    if (r.clientId) await assertClientAccess(ctx, r.clientId);
    if (op === "retry") await retryRun(runId, ctx.orgId);
    else await cancelRun(runId, ctx.orgId);
    await audit({ organizationId: ctx.orgId, clientId: r.clientId, actor: actorOf(ctx), action: `run.${op}`, entityType: "AutomationRun", entityId: r.id, automationRunId: r.id, source: "ui" });
    revalidatePath("/automations/history");
    return { ok: true, message: op === "retry" ? "Re-queued" : "Cancelled" };
  });
}

export async function runSchedulerNowAction(): Promise<ActionResult> {
  return guarded(["manage_automations"], async (ctx) => {
    await enqueue("scheduler.tick", {}, { organizationId: ctx.orgId, label: "Scheduler tick (manual)", triggeredBy: "HUMAN", priority: 1 });
    await enqueue("watchdog.scan", {}, { organizationId: ctx.orgId, label: "Watchdog scan (manual)", triggeredBy: "HUMAN", priority: 1 });
    return { ok: true, message: "Scheduler and watchdog queued." };
  });
}

// ───────── Agency assistant (spec §75) ─────────
export async function agencyAssistantAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["use_agency_assistant"], async (ctx) => {
    const q = fd.str(f, "q").slice(0, 500);
    if (/generate tasks for (all )?critical/i.test(q)) {
      if (!ctx.can("create_tasks")) throw new Error("You can't create tasks");
      const ids = await accessibleClientIds(ctx);
      const flagged = await scanClients(ctx.orgId, { act: true, clientIds: ids ?? undefined });
      return { ok: true, message: `Created follow-up tasks for **${flagged.length}** at-risk client(s):\n${flagged.map((c) => `- ${c.name}: ${c.flags.map((x) => x.label).join("; ")}`).join("\n")}` };
    }
    const r = await askAgencyAssistant(ctx.orgId, await accessibleClientIds(ctx), q);
    return { ok: true, message: r.data };
  });
}

// ───────── Reviews ─────────
export async function reviewReplyAction(reviewId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_reviews"], async (ctx) => {
    const r = await db.gbpReview.findFirstOrThrow({ where: { id: reviewId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, r.clientId);
    const text = fd.str(f, "reply");
    if (text.length < 5) throw new Error("Write a reply");
    const post = fd.str(f, "intent") === "post";
    if (post && !ctx.can("approve_content")) throw new Error("You can save a draft; approval is needed to post");
    await db.gbpReview.update({ where: { id: r.id }, data: { replyDraft: text, replyStatus: post ? "APPROVED" : "DRAFTED" } });
    await db.approval.updateMany({ where: { reviewId: r.id, status: "PENDING" }, data: post ? { status: "APPROVED", decidedAt: new Date(), decidedById: ctx.memberId, afterValue: text } : { afterValue: text } });
    if (post) await enqueue("reviews.post_reply", { reviewId: r.id }, { organizationId: ctx.orgId, clientId: r.clientId, label: "Post review reply", triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 1 });
    await audit({ organizationId: ctx.orgId, clientId: r.clientId, actor: actorOf(ctx), action: post ? "review.reply_post" : "review.reply_draft", entityType: "GbpReview", entityId: r.id, newValue: text, source: "ui" });
    revalidatePath("/reviews");
    revalidatePath(`/clients/${r.clientId}`, "layout");
    return { ok: true, message: post ? "Reply approved — posting to Google." : "Draft saved." };
  });
}

export async function regenerateReplyAction(reviewId: string): Promise<ActionResult> {
  return guarded(["manage_reviews"], async (ctx) => {
    const r = await db.gbpReview.findFirstOrThrow({ where: { id: reviewId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, r.clientId);
    const { loadBrain } = await import("@/lib/ai/brain");
    const { generateReviewReply } = await import("@/lib/ai/generators");
    const brain = await loadBrain(r.clientId);
    const prev = await db.gbpReview.findMany({ where: { clientId: r.clientId, replyText: { not: null } }, take: 10, orderBy: { repliedAt: "desc" }, select: { replyText: true } });
    const { reply } = await generateReviewReply(brain, { reviewerName: r.reviewerName, rating: r.rating, comment: r.comment, servicesMentioned: r.servicesMentioned }, [...prev.map((p) => p.replyText!), r.replyDraft ?? ""]);
    await db.gbpReview.update({ where: { id: r.id }, data: { replyDraft: reply } });
    revalidatePath("/reviews");
    revalidatePath(`/clients/${r.clientId}`, "layout");
    return { ok: true };
  });
}

// ───────── Reports ─────────
export async function generateReportAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["generate_reports"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const type = fd.str(f, "type") || "MONTHLY_SEO";
    const valid = ["WEEKLY_SUMMARY", "MONTHLY_SEO", "GBP", "WEBSITE_SEO", "RANKING", "CONTENT", "SUPPORT", "EXECUTIVE"];
    if (!valid.includes(type)) throw new Error("Invalid report type");
    await enqueue("report.generate", { clientId, type, send: fd.bool(f, "send") }, { organizationId: ctx.orgId, clientId, label: `Report: ${type.toLowerCase()}`, triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 1 });
    revalidatePath(`/clients/${clientId}/reports`);
    return { ok: true, message: "Report is being generated — it will appear in a few seconds." };
  });
}
