import type { Prisma, RiskLevel, Severity } from "@prisma/client";
import { db } from "../db";
import { activity, audit, AI_ACTOR, type Actor } from "../audit";
import { enqueue } from "../jobs/queue";
import { createTask } from "../tasks";
import { addDays } from "../utils";
import { ACTIONS, decide } from "./risk";

/** Structured AI action (spec §93). */
export interface StructuredAction {
  clientId: string;
  action: string;
  title: string;
  target?: string | null;
  reason: string;
  seoBenefit?: string;
  currentValue?: string | null;
  suggestedValue?: string | null;
  confidence: number;
  severity?: Severity;
  sourceSignals: string[];
  evidence?: Record<string, unknown>;
  expectedImpact?: string;
  executeAfter?: Date;
  locationId?: string | null;
  payload?: Record<string, unknown>;
  safetyIssues?: string[];
  dedupeKey?: string;
}

/** When was the target last majorly changed? Returns end of observation window or null. */
export async function cooldownUntil(clientId: string, target: string | null | undefined, observationDays: number) {
  if (!target) return null;
  const majorFields = Object.entries(ACTIONS).filter(([, m]) => m.major).map(([k]) => k);
  const last = await db.seoAction.findFirst({
    where: { clientId, target, status: { in: ["APPLIED", "VERIFIED"] }, field: { in: majorFields }, createdAt: { gte: addDays(new Date(), -observationDays) } },
    orderBy: { createdAt: "desc" },
  });
  return last ? addDays(last.createdAt, observationDays) : null;
}

/**
 * Propose an AI action. Runs it through the risk engine and routes it to auto-execution,
 * the approval center, a manual task, or monitor-only — then audits the decision.
 */
export async function proposeAction(a: StructuredAction, actor: Actor = AI_ACTOR) {
  const meta = ACTIONS[a.action];
  const client = await db.client.findUniqueOrThrow({ where: { id: a.clientId }, include: { automation: true, consent: true, organization: true } });
  const dedupeKey = a.dedupeKey ?? `${a.action}:${a.target ?? ""}`;

  const existing = await db.aiRecommendation.findUnique({ where: { clientId_dedupeKey: { clientId: a.clientId, dedupeKey } } });
  if (existing && ["NEEDS_APPROVAL", "APPROVED", "SCHEDULED", "EXECUTING"].includes(existing.status)) return existing;
  if (existing && existing.status === "REJECTED" && existing.updatedAt > addDays(new Date(), -30)) return existing; // respect human rejection for 30 days

  const observationDays = client.automation?.observationDays ?? client.organization.observationDays;
  const cd = await cooldownUntil(a.clientId, a.target, observationDays);
  const decision = decide({
    action: a.action,
    confidence: a.confidence,
    severity: a.severity ?? "MEDIUM",
    safetyIssues: a.safetyIssues,
    automationPaused: client.automationPaused,
    clientStatus: client.status,
    level: client.automation?.level ?? "ASSIST",
    consent: client.consent,
    settings: client.automation,
    minAutoConfidence: client.organization.minAutoConfidence,
    cooldownUntil: cd,
  });

  const status =
    decision.mode === "AUTO" ? "SCHEDULED" : decision.mode === "APPROVAL" ? "NEEDS_APPROVAL" : decision.mode === "REJECT" ? "REJECTED" : "PROPOSED";
  const data = {
    organizationId: client.organizationId,
    clientId: a.clientId,
    locationId: a.locationId ?? null,
    domain: meta?.domain ?? "STRATEGY",
    action: a.action,
    title: a.title,
    target: a.target ?? null,
    reason: a.reason,
    seoBenefit: a.seoBenefit,
    currentValue: a.currentValue ?? null,
    suggestedValue: a.suggestedValue ?? null,
    risk: (meta?.risk ?? "HIGH") as RiskLevel,
    actionClass: meta?.actionClass ?? "PROTECTED",
    confidence: a.confidence,
    severity: a.severity ?? "MEDIUM",
    sourceSignals: a.sourceSignals,
    evidence: (a.evidence ?? undefined) as Prisma.InputJsonValue | undefined,
    expectedImpact: a.expectedImpact,
    status: status as "SCHEDULED",
    executeAfter: decision.mode === "DEFER" ? decision.until : a.executeAfter ?? new Date(),
    blockedReason: decision.mode === "AUTO" ? null : decision.reason,
    payload: (a.payload ?? undefined) as Prisma.InputJsonValue | undefined,
    dedupeKey,
    createdBy: actor.type,
  };
  const rec = existing
    ? await db.aiRecommendation.update({ where: { id: existing.id }, data: { ...data, executedAt: null, verifiedAt: null, outcome: null } })
    : await db.aiRecommendation.create({ data });

  if (decision.mode === "AUTO") {
    await enqueue("recommendation.execute", { recommendationId: rec.id }, {
      organizationId: client.organizationId,
      clientId: client.id,
      label: rec.title,
      runAt: rec.executeAfter ?? new Date(),
      dedupeKey: `exec:${rec.id}:${rec.updatedAt.getTime()}`,
    });
  } else if (decision.mode === "APPROVAL") {
    await db.approval.upsert({
      where: { recommendationId: rec.id },
      create: {
        organizationId: client.organizationId,
        clientId: client.id,
        category: meta?.approvalCategory ?? "TECHNICAL",
        title: rec.title,
        description: decision.reason,
        beforeValue: rec.currentValue,
        afterValue: rec.suggestedValue,
        reason: rec.reason,
        risk: rec.risk,
        confidence: rec.confidence,
        recommendationId: rec.id,
        requiresClient: decision.requiresClient,
      },
      update: { status: "PENDING", beforeValue: rec.currentValue, afterValue: rec.suggestedValue, reason: rec.reason, description: decision.reason, decidedAt: null, decidedById: null },
    });
  } else if (decision.mode === "MANUAL") {
    await createTask({
      organizationId: client.organizationId,
      clientId: client.id,
      title: rec.title,
      description: `${rec.reason}\n\nSuggested: ${rec.suggestedValue ?? "—"}\n\nWhy manual: ${decision.reason}`,
      category: meta?.domain === "WEBSITE" ? "Website" : meta?.domain === "GBP" ? "GBP" : "SEO",
      priority: rec.severity === "CRITICAL" ? "URGENT" : rec.severity === "HIGH" ? "HIGH" : "NORMAL",
      source: "AI",
      sourceRef: rec.id,
      dedupeKey: `rec:${rec.id}`,
    });
  }

  await audit({
    organizationId: client.organizationId,
    clientId: client.id,
    actor,
    action: `recommendation.${decision.mode.toLowerCase()}`,
    entityType: "AiRecommendation",
    entityId: rec.id,
    newValue: { action: a.action, decision: decision.mode, reason: decision.reason, confidence: a.confidence, signals: a.sourceSignals },
    source: "engine",
  });
  return rec;
}

/** Human decision on an approval (approve / reject / request changes), with optional edit. */
export async function decideApproval(args: {
  approvalId: string;
  organizationId: string;
  decision: "APPROVED" | "REJECTED" | "CHANGES_REQUESTED";
  actor: Actor;
  editedValue?: string | null;
  note?: string | null;
  scheduleFor?: Date | null;
}) {
  const approval = await db.approval.findFirst({ where: { id: args.approvalId, organizationId: args.organizationId } });
  if (!approval || approval.status !== "PENDING") return null;
  const afterValue = args.editedValue?.trim() ? args.editedValue.trim() : approval.afterValue;
  const updated = await db.approval.update({
    where: { id: approval.id },
    data: { status: args.decision, decidedById: args.actor.id ?? null, decidedAt: new Date(), decisionNote: args.note ?? null, afterValue, scheduledFor: args.scheduleFor ?? null },
  });

  if (approval.recommendationId) {
    if (args.decision === "APPROVED") {
      const rec = await db.aiRecommendation.update({
        where: { id: approval.recommendationId },
        data: { status: "APPROVED", suggestedValue: afterValue, executeAfter: args.scheduleFor ?? new Date() },
      });
      await enqueue("recommendation.execute", { recommendationId: rec.id, approvalId: approval.id }, {
        organizationId: approval.organizationId,
        clientId: approval.clientId,
        label: rec.title,
        runAt: args.scheduleFor ?? new Date(),
        triggeredBy: args.actor.type,
        triggeredById: args.actor.id,
        dedupeKey: `exec:${rec.id}:approved:${approval.id}`,
      });
    } else {
      await db.aiRecommendation.update({ where: { id: approval.recommendationId }, data: { status: args.decision === "REJECTED" ? "REJECTED" : "PROPOSED", blockedReason: args.note ?? "Changes requested" } });
    }
  }
  if (approval.contentItemId) {
    const item = await db.contentItem.findUnique({ where: { id: approval.contentItemId } });
    if (item) {
      if (args.decision === "APPROVED") {
        const when = args.scheduleFor ?? item.scheduledFor ?? new Date();
        await db.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED", scheduledFor: when, body: approval.category === "CONTENT" && args.editedValue?.trim() ? args.editedValue.trim() : item.body } });
        if (item.imageId) await db.mediaAsset.update({ where: { id: item.imageId }, data: { status: "APPROVED", approvedForGbp: item.type === "GBP_POST" ? true : undefined, approvedForBlog: item.type === "BLOG" ? true : undefined } });
        await enqueue("content.publish", { contentItemId: item.id }, { organizationId: item.organizationId, clientId: item.clientId, label: `Publish: ${item.title}`, runAt: when, dedupeKey: `publish:${item.id}:${when.getTime()}` });
      } else {
        await db.contentItem.update({ where: { id: item.id }, data: { status: args.decision === "REJECTED" ? "REJECTED" : "DRAFT" } });
      }
    }
  }
  if (approval.reviewId) {
    if (args.decision === "APPROVED") {
      await db.gbpReview.update({ where: { id: approval.reviewId }, data: { replyStatus: "APPROVED", replyDraft: afterValue } });
      await enqueue("reviews.post_reply", { reviewId: approval.reviewId }, { organizationId: approval.organizationId, clientId: approval.clientId, label: "Post approved review reply", dedupeKey: `reply:${approval.reviewId}:${approval.id}` });
    } else {
      await db.gbpReview.update({ where: { id: approval.reviewId }, data: { replyStatus: args.decision === "REJECTED" ? "SKIPPED" : "DRAFTED" } });
    }
  }
  await db.task.updateMany({ where: { organizationId: approval.organizationId, dedupeKey: `approval:${approval.id}`, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
  await audit({
    organizationId: approval.organizationId,
    clientId: approval.clientId,
    actor: args.actor,
    action: `approval.${args.decision.toLowerCase()}`,
    entityType: "Approval",
    entityId: approval.id,
    oldValue: { after: approval.afterValue },
    newValue: { after: afterValue, note: args.note },
    approvalId: approval.id,
    source: args.actor.type === "CLIENT" ? "portal" : "ui",
  });
  await activity({
    organizationId: approval.organizationId,
    clientId: approval.clientId,
    category: args.actor.type === "CLIENT" ? "CLIENT" : "AI",
    type: `approval.${args.decision.toLowerCase()}`,
    title: `${args.decision === "APPROVED" ? "Approved" : args.decision === "REJECTED" ? "Rejected" : "Changes requested"}: ${approval.title}`,
    actor: args.actor,
    entityType: "Approval",
    entityId: approval.id,
  });
  return updated;
}
