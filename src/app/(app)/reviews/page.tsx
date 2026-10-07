import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { PageHeader, Stat } from "@/components/ui";
import { ReviewsList } from "@/components/reviews-list";
import { cn } from "@/lib/utils";

export const metadata = { title: "Reviews" };

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const filter = sp.filter ?? "unanswered";
  const where = { ...scope, ...(filter === "unanswered" ? { replyStatus: { not: "POSTED" as const } } : filter === "negative" ? { rating: { lte: 3 }, replyStatus: { not: "POSTED" as const } } : {}) };
  const [reviews, total, unanswered, negative, agg] = await Promise.all([
    db.gbpReview.findMany({ where, orderBy: [{ rating: "asc" }, { reviewedAt: "desc" }], take: 80, include: { client: { select: { name: true } } } }),
    db.gbpReview.count({ where: scope }),
    db.gbpReview.count({ where: { ...scope, replyStatus: { not: "POSTED" } } }),
    db.gbpReview.count({ where: { ...scope, rating: { lte: 3 }, replyStatus: { not: "POSTED" } } }),
    db.gbpReview.aggregate({ where: scope, _avg: { rating: true } }),
  ]);
  return (
    <>
      <PageHeader title="Reviews" subtitle="Reputation inbox across all clients — AI drafts personalised replies; critical reviews become urgent workflows" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Total reviews" value={total} />
        <Stat label="Average rating" value={`${agg._avg.rating?.toFixed(2) ?? "—"}★`} />
        <Stat label="Awaiting reply" value={unanswered} tone={unanswered ? "amber" : "green"} />
        <Stat label="Critical (1–3★)" value={negative} tone={negative ? "red" : "green"} />
      </div>
      <div className="mb-4 flex gap-2">{[["unanswered", "Awaiting reply"], ["negative", "Critical"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`?filter=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", filter === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>{l}</Link>)}</div>
      <ReviewsList reviews={reviews} canReply={ctx.can("manage_reviews")} canPost={ctx.can("approve_content")} showClient />
    </>
  );
}
