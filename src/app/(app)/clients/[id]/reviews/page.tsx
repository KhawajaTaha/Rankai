import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { Stat } from "@/components/ui";
import { ReviewsList } from "@/components/reviews-list";
import { cn } from "@/lib/utils";

export default async function ClientReviews({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ filter?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  await getAccessibleClient(ctx, id);
  const where = { clientId: id, ...(sp.filter === "unanswered" ? { replyStatus: { not: "POSTED" as const } } : sp.filter === "negative" ? { rating: { lte: 3 } } : {}) };
  const [reviews, agg, unanswered, settings] = await Promise.all([
    db.gbpReview.findMany({ where, orderBy: { reviewedAt: "desc" }, take: 100 }),
    db.gbpReview.aggregate({ where: { clientId: id }, _avg: { rating: true }, _count: true }),
    db.gbpReview.count({ where: { clientId: id, replyStatus: { not: "POSTED" } } }),
    db.automationSetting.findUnique({ where: { clientId: id } }),
  ]);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Average rating" value={`${agg._avg.rating?.toFixed(2) ?? "—"}★`} />
        <Stat label="Total reviews" value={agg._count} />
        <Stat label="Awaiting reply" value={unanswered} tone={unanswered ? "amber" : "green"} />
        <Stat label="Auto-reply" value={settings?.reviewAutoReply === "AUTO_POSITIVE" ? "Positive" : settings?.reviewAutoReply === "NEVER" ? "Never" : "Approval"} hint={`5★ ${settings?.autoReply5 ? "auto" : "approval"} · 4★ ${settings?.autoReply4 ? "auto" : "approval"} · 1–3★ approval`} href={`/clients/${id}/automations`} />
      </div>
      <div className="flex gap-2">{[["all", "All"], ["unanswered", "Unanswered"], ["negative", "1–3 stars"]].map(([k, l]) => <Link key={k} href={`?filter=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", (sp.filter ?? "all") === k ? "bg-brand-600 text-white ring-brand-600" : "ring-ink-200 bg-white")}>{l}</Link>)}</div>
      <ReviewsList reviews={reviews} canReply={ctx.can("manage_reviews")} canPost={ctx.can("approve_content")} />
    </div>
  );
}
