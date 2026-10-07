import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, Stat, timeAgo } from "@/components/ui";
import { Stars } from "@/components/reviews-list";

export const metadata = { title: "Reviews" };

export default async function PortalReviews() {
  const ctx = await requirePortal();
  const [reviews, agg] = await Promise.all([
    db.gbpReview.findMany({ where: { clientId: ctx.portalClientId }, orderBy: { reviewedAt: "desc" }, take: 50 }),
    db.gbpReview.aggregate({ where: { clientId: ctx.portalClientId }, _avg: { rating: true }, _count: true }),
  ]);
  const replied = reviews.filter((r) => r.replyStatus === "POSTED").length;
  return (
    <>
      <PageHeader title="Reviews" subtitle="We reply to every review on your behalf" />
      <div className="mb-5 grid grid-cols-3 gap-3"><Stat label="Average rating" value={`${agg._avg.rating?.toFixed(1) ?? "—"}★`} /><Stat label="Total reviews" value={agg._count} /><Stat label="Replied (recent)" value={`${replied}/${reviews.length}`} /></div>
      <div className="space-y-3">{reviews.map((r) => (
        <Card key={r.id}><div className="flex items-center gap-2 text-sm"><b>{r.reviewerName}</b><Stars n={r.rating} /><span className="ml-auto text-xs text-ink-400">{timeAgo(r.reviewedAt)}</span></div><p className="mt-1 text-sm text-ink-700">{r.comment}</p>{r.replyText && <p className="mt-2 rounded-xl bg-ink-50 p-3 text-sm text-ink-600"><b>Your reply:</b> {r.replyText}</p>}</Card>
      ))}</div>
    </>
  );
}
