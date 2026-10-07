import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader, StatusBadge, fmtDate } from "@/components/ui";

export const metadata = { title: "Content" };

export default async function PortalContent() {
  const ctx = await requirePortal();
  const items = await db.contentItem.findMany({ where: { clientId: ctx.portalClientId, status: { in: ["PUBLISHED", "SCHEDULED", "NEEDS_APPROVAL"] } }, orderBy: { scheduledFor: "desc" }, take: 60, include: { image: true } });
  return (
    <>
      <PageHeader title="Content" subtitle="Posts and articles published for your business" />
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {items.map((i) => (
          <div key={i.id} className="card overflow-hidden">
            {i.image ? (  <img src={i.image.url} alt="" className="aspect-video w-full object-cover" />) : <div className="aspect-video bg-ink-100" />}
            <div className="p-4">
              <div className="flex items-center justify-between gap-2"><span className="text-xs text-ink-500">{i.type === "BLOG" ? "Article" : "Google post"} · {fmtDate(i.publishedAt ?? i.scheduledFor)}</span><StatusBadge status={i.status} /></div>
              <h3 className="mt-1 text-sm font-semibold">{i.title}</h3>
              <p className="mt-1 line-clamp-3 text-xs text-ink-600">{i.body?.replace(/[#*]/g, "")}</p>
            </div>
          </div>
        ))}
      </div>
      {!items.length && <Card><EmptyState title="No content yet" /></Card>}
    </>
  );
}
