import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { addDays, localIso } from "@/lib/utils";
import { PageHeader, Stat } from "@/components/ui";
import { ContentCalendar } from "@/components/calendar";

export const metadata = { title: "Content" };

export default async function ContentPage({ searchParams }: { searchParams: Promise<{ client?: string; type?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const clients = await db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } });
  const clientId = sp.client && clients.some((c) => c.id === sp.client) ? sp.client : undefined;
  const where = { ...scope, ...(clientId ? { clientId } : {}), ...(sp.type ? { type: sp.type as "BLOG" } : {}) };
  const [items, counts] = await Promise.all([
    db.contentItem.findMany({ where: { ...where, scheduledFor: { gte: addDays(new Date(), -45), lte: addDays(new Date(), 90) }, status: { not: "REJECTED" } }, include: { client: { select: { name: true } } }, orderBy: { scheduledFor: "asc" }, take: 1500 }),
    db.contentItem.groupBy({ by: ["status"], where, _count: true }),
  ]);
  const c = (s: string) => counts.find((x) => x.status === s)?._count ?? 0;
  return (
    <>
      <PageHeader title="Content" subtitle="AI-populated content calendar across clients — GBP posts, blogs and more" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <Stat label="Ideas planned" value={c("IDEA")} />
        <Stat label="Needs approval" value={c("NEEDS_APPROVAL")} href="/approvals?category=CONTENT" tone={c("NEEDS_APPROVAL") ? "amber" : undefined} />
        <Stat label="Scheduled" value={c("SCHEDULED")} />
        <Stat label="Published" value={c("PUBLISHED")} tone="green" />
        <Stat label="Failed" value={c("FAILED")} tone={c("FAILED") ? "red" : undefined} />
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <select name="client" defaultValue={clientId ?? ""} className="input h-9 w-auto"><option value="">All clients</option>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select>
        <select name="type" defaultValue={sp.type ?? ""} className="input h-9 w-auto"><option value="">All types</option>{["GBP_POST", "BLOG", "SOCIAL", "WEBSITE_UPDATE", "EMAIL", "SEO_TASK", "REVIEW_CAMPAIGN"].map((t) => <option key={t} value={t}>{t.replace("_", " ").toLowerCase()}</option>)}</select>
        <button className="btn-secondary h-9">Filter</button>
      </form>
      <ContentCalendar canReschedule={ctx.can("publish_content")} items={items.map((i) => ({ id: i.id, title: i.title, type: i.type, status: i.status, date: localIso(i.publishedAt ?? i.scheduledFor!), client: clientId ? undefined : i.client.name }))} />
    </>
  );
}
