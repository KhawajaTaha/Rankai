import { db } from "../db";
import { activity, AI_ACTOR, type Actor } from "../audit";
import { loadBrain } from "../ai/brain";
import { analyzeReview, generateReviewReply } from "../ai/generators";
import { proposeAction } from "../engine/recommendations";
import { gbpProvider } from "../integrations/gbp";
import { raiseAlert } from "../notify";
import { createTask } from "../tasks";
import { NotConfiguredError } from "../errors";

/**
 * Review workflow (spec §26-27):
 *  sentiment + services → personalised AI reply draft →
 *   4-5★: auto-reply through the risk engine (consent + settings) or approval
 *   1-3★: alert + urgent support task + reply draft awaiting approval
 */
export async function processNewReview(reviewId: string) {
  const review = await db.gbpReview.findUniqueOrThrow({ where: { id: reviewId } });
  if (review.replyStatus === "POSTED") return { skipped: "already replied" };
  const brain = await loadBrain(review.clientId);
  const settings = brain.settings;
  const { sentiment, servicesMentioned } = analyzeReview(brain, review.rating, review.comment);
  const previous = await db.gbpReview.findMany({ where: { clientId: review.clientId, replyText: { not: null } }, orderBy: { repliedAt: "desc" }, take: 10, select: { replyText: true } });
  let reply = "";
  try {
    reply = (await generateReviewReply(brain, { reviewerName: review.reviewerName, rating: review.rating, comment: review.comment, servicesMentioned }, previous.map((p) => p.replyText!))).reply;
  } catch (e) {
    if (!(e instanceof NotConfiguredError)) throw e;
    // Live mode without AI: still run the reputation workflow, a human writes the reply.
    await db.gbpReview.update({ where: { id: review.id }, data: { sentiment, servicesMentioned, replyStatus: "UNANSWERED" } });
    if (review.rating >= 4) {
      await createTask({ organizationId: review.organizationId, clientId: review.clientId, title: `Reply to ${review.rating}★ review from ${review.reviewerName}`, category: "Review", priority: "LOW", source: "REVIEW_ALERT", sourceRef: review.id, dedupeKey: `review:${review.id}` });
      return { routed: "manual (AI not configured)" };
    }
  }
  await db.gbpReview.update({ where: { id: review.id }, data: { sentiment, servicesMentioned, ...(reply ? { replyDraft: reply, replyStatus: "DRAFTED" as const } : {}) } });

  const positive = review.rating >= 4;
  if (settings?.reviewAutoReply === "NEVER") {
    await createTask({ organizationId: review.organizationId, clientId: review.clientId, title: `Reply to ${review.rating}★ review from ${review.reviewerName}`, description: `Suggested reply:\n${reply}`, category: "Review", priority: positive ? "LOW" : "HIGH", source: "REVIEW_ALERT", sourceRef: review.id, dedupeKey: `review:${review.id}` });
    return { routed: "manual" };
  }

  if (positive) {
    const allowedAuto = settings?.reviewAutoReply === "AUTO_POSITIVE" && ((review.rating === 5 && (settings.autoReply5 ?? true)) || (review.rating === 4 && settings.autoReply4));
    if (allowedAuto) {
      const rec = await proposeAction({
        clientId: review.clientId, locationId: review.locationId, action: "reply_review_positive", title: `Reply to ${review.rating}★ review from ${review.reviewerName}`,
        target: `review:${review.id}`, reason: "Responding to reviews builds trust and is a local ranking signal.", currentValue: review.comment, suggestedValue: reply,
        confidence: 0.92, severity: "LOW", sourceSignals: ["new_review"], payload: { reviewId: review.id }, dedupeKey: `reply:${review.id}`,
      });
      if (rec.status === "NEEDS_APPROVAL") await db.gbpReview.update({ where: { id: review.id }, data: { replyStatus: "NEEDS_APPROVAL" } });
      return { routed: rec.status };
    }
    await db.approval.create({ data: { organizationId: review.organizationId, clientId: review.clientId, category: "REVIEWS", title: `Reply to ${review.rating}★ review from ${review.reviewerName}`, beforeValue: review.comment, afterValue: reply, reason: "Positive review reply draft", risk: "LOW", confidence: 0.9, reviewId: review.id } });
    await db.gbpReview.update({ where: { id: review.id }, data: { replyStatus: "NEEDS_APPROVAL" } });
    return { routed: "approval" };
  }

  // Negative / neutral review → reputation workflow.
  const severity = review.rating <= 2 ? "CRITICAL" : "HIGH";
  await raiseAlert({
    organizationId: review.organizationId,
    clientId: review.clientId,
    severity,
    type: "negative_review",
    title: `${review.rating}-Star Review Received — ${brain.client.name}`,
    detail: `${review.reviewerName}: "${(review.comment ?? "").slice(0, 200)}"`,
    dedupeKey: `review:${review.id}`,
    entityType: "GbpReview",
    entityId: review.id,
    link: `/clients/${review.clientId}/reviews`,
  });
  await createTask({
    organizationId: review.organizationId,
    clientId: review.clientId,
    title: `${review.rating}★ review from ${review.reviewerName} — respond and follow up`,
    description: `Review: "${review.comment ?? "(no text)"}"\n\nA reply draft is waiting in the Approval Center. Consider calling the client before replying publicly.`,
    category: "Review",
    priority: review.rating <= 2 ? "URGENT" : "HIGH",
    source: "REVIEW_ALERT",
    sourceRef: review.id,
    dedupeKey: `review:${review.id}`,
  });
  await db.approval.create({ data: { organizationId: review.organizationId, clientId: review.clientId, category: "REVIEWS", title: `Reply to ${review.rating}★ review from ${review.reviewerName}`, beforeValue: review.comment, afterValue: reply, reason: "Critical review — human approval required", risk: "MEDIUM", confidence: 0.75, reviewId: review.id, requiresClient: review.rating <= 2 } });
  await db.gbpReview.update({ where: { id: review.id }, data: { replyStatus: "NEEDS_APPROVAL", alertCreated: true } });
  await activity({ organizationId: review.organizationId, clientId: review.clientId, category: "GBP", type: "review.negative", title: `${review.rating}★ review received — alert raised`, actor: AI_ACTOR });
  return { routed: "negative_workflow" };
}

/** Post an approved reply to Google and verify it stuck. */
export async function postReviewReply(reviewId: string, actor: Actor) {
  const review = await db.gbpReview.findUniqueOrThrow({ where: { id: reviewId }, include: { location: { include: { account: { include: { connection: true } } } } } });
  const text = review.replyDraft?.trim();
  if (!text) throw new Error("No reply text to post");
  const provider = gbpProvider(review.location.account.connection);
  await provider.replyToReview(review.googleName, text);
  await db.gbpReview.update({ where: { id: review.id }, data: { replyText: text, replyStatus: "POSTED", repliedAt: new Date(), repliedBy: actor.type } });
  await db.task.updateMany({ where: { organizationId: review.organizationId, dedupeKey: `review:${review.id}`, status: { notIn: ["COMPLETED", "CANCELLED"] } }, data: { status: "COMPLETED", completedAt: new Date() } });
  await db.alert.updateMany({ where: { organizationId: review.organizationId, dedupeKey: `review:${review.id}`, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
  await activity({ organizationId: review.organizationId, clientId: review.clientId, category: "GBP", type: "review.replied", title: `Replied to ${review.rating}★ review from ${review.reviewerName}`, actor });
}
