import Link from "next/link";
import { Star } from "lucide-react";
import type { GbpReview } from "@prisma/client";
import { Badge, Card, EmptyState, StatusBadge, timeAgo } from "./ui";
import { ActionButton, ActionForm, SubmitButton } from "./client";
import { regenerateReplyAction, reviewReplyAction } from "@/app/actions/ops";

export function Stars({ n }: { n: number }) {
  return <span className="inline-flex">{[1, 2, 3, 4, 5].map((i) => <Star key={i} className={`h-3.5 w-3.5 ${i <= n ? "fill-amber-400 text-amber-400" : "text-ink-200"}`} />)}</span>;
}

export function ReviewsList({ reviews, canReply, canPost, showClient }: { reviews: (GbpReview & { client?: { name: string } })[]; canReply: boolean; canPost: boolean; showClient?: boolean }) {
  if (!reviews.length) return <Card><EmptyState icon={<Star className="h-5 w-5" />} title="No reviews match" /></Card>;
  return (
    <div className="space-y-3">
      {reviews.map((r) => (
        <div key={r.id} className={`card p-4 ${r.rating <= 2 && r.replyStatus !== "POSTED" ? "border-red-200" : ""}`}>
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-semibold">{r.reviewerName}</span>
            <Stars n={r.rating} />
            {r.sentiment && <Badge tone={r.sentiment === "POSITIVE" ? "green" : r.sentiment === "NEGATIVE" ? "red" : "gray"}>{r.sentiment.toLowerCase()}</Badge>}
            {r.servicesMentioned.map((s) => <Badge key={s} tone="blue">{s}</Badge>)}
            <StatusBadge status={r.replyStatus} />
            {showClient && r.client && <Link href={`/clients/${r.clientId}/reviews`} className="text-xs text-ink-500 hover:text-brand-700">· {r.client.name}</Link>}
            <span className="ml-auto text-xs text-ink-400">{timeAgo(r.reviewedAt)}</span>
          </div>
          <p className="mt-2 text-sm text-ink-700">{r.comment ?? <span className="italic text-ink-400">No text — rating only</span>}</p>
          {r.replyStatus === "POSTED" ? (
            <div className="mt-3 rounded-xl bg-ink-50 p-3 text-sm text-ink-700"><span className="text-xs font-medium text-ink-500">Reply{r.repliedBy ? ` (${r.repliedBy.toLowerCase()})` : ""}: </span>{r.replyText}</div>
          ) : canReply ? (
            <ActionForm action={reviewReplyAction.bind(null, r.id)} resetOnSuccess={false} className="mt-3">
              <textarea name="reply" rows={3} defaultValue={r.replyDraft ?? ""} className="input text-sm" placeholder="Write a personalised reply…" />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {canPost && <SubmitButton className="btn-primary btn-sm" name="intent" value="post">Approve & post</SubmitButton>}
                <SubmitButton className="btn-secondary btn-sm" name="intent" value="draft">Save draft</SubmitButton>
                <ActionButton action={regenerateReplyAction.bind(null, r.id)} className="btn-ghost btn-sm">Regenerate with AI</ActionButton>
                {r.rating <= 3 && <span className="text-xs text-amber-700">Critical review — consider calling the customer first.</span>}
              </div>
            </ActionForm>
          ) : null}
        </div>
      ))}
    </div>
  );
}
