import Link from "next/link";
import type { MediaFolder } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { addDays, localIso } from "@/lib/utils";
import { Badge, Card, EmptyState, StatusBadge, Tabs, fmtDate } from "@/components/ui";
import { ActionForm, Dialog, Field, SubmitButton } from "@/components/client";
import { ContentCalendar } from "@/components/calendar";
import { GenerateContentForm } from "@/components/forms";
import { updateMediaAction, uploadMediaAction } from "@/app/actions/clients";
import { pretty } from "@/lib/labels";

const FOLDERS: MediaFolder[] = ["LOGO", "TEAM", "PRODUCTS", "SERVICES", "PROJECTS", "BEFORE_AFTER", "AI_GENERATED", "GBP", "BLOGS", "SOCIAL_MEDIA"];

export default async function ClientContent({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; folder?: string; q?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  await getAccessibleClient(ctx, id);
  const tab = ["calendar", "items", "media", "memory"].includes(sp.tab ?? "") ? sp.tab! : "calendar";
  const base = `/clients/${id}/content`;
  const knowledge = await db.clientKnowledge.findUnique({ where: { clientId: id }, select: { services: true } });

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs active={`${base}?tab=${tab}`} tabs={[{ href: `${base}?tab=calendar`, label: "Calendar" }, { href: `${base}?tab=items`, label: "All content" }, { href: `${base}?tab=media`, label: "Media Library" }, { href: `${base}?tab=memory`, label: "Content memory" }]} />
        {ctx.can("create_content") && (
          <div className="flex gap-2">
            <Dialog trigger="+ GBP Post" title="Generate GBP post" triggerClassName="btn-secondary btn-sm"><GenerateContentForm clientId={id} type="GBP_POST" services={knowledge?.services ?? []} /></Dialog>
            <Dialog trigger="+ Blog" title="Generate blog" triggerClassName="btn-primary btn-sm"><GenerateContentForm clientId={id} type="BLOG" services={knowledge?.services ?? []} /></Dialog>
          </div>
        )}
      </div>
      {tab === "calendar" && <CalendarTab clientId={id} canReschedule={ctx.can("publish_content")} />}
      {tab === "items" && <ItemsTab clientId={id} />}
      {tab === "media" && <MediaTab clientId={id} folder={sp.folder} q={sp.q} canManage={ctx.can("manage_media")} />}
      {tab === "memory" && <MemoryTab clientId={id} />}
    </div>
  );
}

async function CalendarTab({ clientId, canReschedule }: { clientId: string; canReschedule: boolean }) {
  const items = await db.contentItem.findMany({ where: { clientId, scheduledFor: { gte: addDays(new Date(), -60), lte: addDays(new Date(), 120) }, status: { not: "REJECTED" } }, orderBy: { scheduledFor: "asc" } });
  return <ContentCalendar canReschedule={canReschedule} items={items.map((i) => ({ id: i.id, title: i.title, type: i.type, status: i.status, date: localIso(i.publishedAt ?? i.scheduledFor!) }))} />;
}

async function ItemsTab({ clientId }: { clientId: string }) {
  const items = await db.contentItem.findMany({ where: { clientId }, orderBy: [{ scheduledFor: "desc" }], take: 200, include: { image: true } });
  return (
    <Card pad={false}>
      <ul className="divide-y divide-ink-100">
        {items.map((i) => (
          <li key={i.id} className="flex items-center gap-3 px-5 py-3">
            {i.image ? (  <img src={i.image.url} alt="" className="h-12 w-16 rounded-lg object-cover" />) : <div className="h-12 w-16 rounded-lg bg-ink-100" />}
            <div className="min-w-0 flex-1">
              <Link href={`/content/${i.id}`} className="block truncate text-sm font-medium hover:text-brand-700">{i.title}</Link>
              <div className="text-xs text-ink-500">{pretty(i.type)} · {i.servicePromoted ?? "—"} · {i.status === "PUBLISHED" ? `published ${fmtDate(i.publishedAt)}` : `scheduled ${fmtDate(i.scheduledFor, true)}`}</div>
            </div>
            <StatusBadge status={i.status} />
          </li>
        ))}
      </ul>
      {!items.length && <EmptyState title="No content yet" />}
    </Card>
  );
}

async function MediaTab({ clientId, folder, q, canManage }: { clientId: string; folder?: string; q?: string; canManage: boolean }) {
  const media = await db.mediaAsset.findMany({
    where: { clientId, ...(folder && FOLDERS.includes(folder as MediaFolder) ? { folder: folder as MediaFolder } : {}), ...(q ? { OR: [{ tags: { has: q.toLowerCase() } }, { title: { contains: q, mode: "insensitive" } }, { filename: { contains: q, mode: "insensitive" } }] } : {}) },
    orderBy: { createdAt: "desc" },
    include: { aiImage: true },
    take: 200,
  });
  const base = `/clients/${clientId}/content?tab=media`;
  return (
    <div className="grid gap-5 lg:grid-cols-4">
      <div className="space-y-4">
        <Card title="Folders" pad={false}>
          <ul className="p-2">
            <li><Link href={base} className={`block rounded-lg px-3 py-1.5 text-sm ${!folder ? "bg-brand-50 text-brand-700" : "hover:bg-ink-50"}`}>All media</Link></li>
            {FOLDERS.map((f) => <li key={f}><Link href={`${base}&folder=${f}`} className={`block rounded-lg px-3 py-1.5 text-sm ${folder === f ? "bg-brand-50 text-brand-700" : "hover:bg-ink-50"}`}>{pretty(f)}</Link></li>)}
          </ul>
        </Card>
        {canManage && (
          <Card title="Upload">
            <ActionForm action={uploadMediaAction.bind(null, clientId)} className="space-y-3">
              <input name="files" type="file" accept="image/*" multiple className="input py-1.5 text-xs" />
              <Field label="Folder"><select name="folder" className="input" defaultValue={folder ?? "SERVICES"}>{FOLDERS.filter((f) => f !== "AI_GENERATED").map((f) => <option key={f} value={f}>{pretty(f)}</option>)}</select></Field>
              <Field label="Tags"><input name="tags" className="input" placeholder="kitchen, quartz" /></Field>
              <label className="flex items-center gap-2 text-xs"><input type="checkbox" name="approve" className="h-4 w-4 rounded" /> Approve for GBP & blog now</label>
              <SubmitButton className="btn-primary w-full">Upload</SubmitButton>
            </ActionForm>
          </Card>
        )}
      </div>
      <div className="lg:col-span-3">
        <form className="mb-3"><input type="hidden" name="tab" value="media" />{folder && <input type="hidden" name="folder" value={folder} />}<input name="q" defaultValue={q} placeholder="Search tags, titles…" className="input max-w-xs" /></form>
        {media.length ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
            {media.map((m) => (
              <div key={m.id} className="card overflow-hidden">
                { }
                <img src={m.url} alt={m.altText ?? ""} className="aspect-[4/3] w-full bg-ink-100 object-cover" />
                <div className="space-y-1.5 p-2.5">
                  <div className="truncate text-xs font-medium">{m.title ?? m.filename}</div>
                  <div className="flex flex-wrap gap-1">
                    <StatusBadge status={m.status} />
                    {m.isAiGenerated && <Badge tone="purple">AI</Badge>}
                    {m.approvedForGbp && <Badge tone="green">GBP</Badge>}
                    {m.approvedForBlog && <Badge tone="green">Blog</Badge>}
                    {m.approvedForAds && <Badge tone="green">Ads</Badge>}
                  </div>
                  {m.aiImage && <div className="text-[10px] text-ink-400">{m.aiImage.provider} · quality {Math.round((m.aiImage.qualityScore ?? 0) * 100)}% · safety {m.aiImage.safetyPassed ? "passed" : "rewritten"}</div>}
                  {canManage && (
                    <Dialog trigger="Edit" title="Media details" triggerClassName="btn-ghost btn-sm w-full">
                      <ActionForm action={updateMediaAction.bind(null, m.id)} resetOnSuccess={false} className="grid gap-3">
                        <Field label="Status"><select name="status" defaultValue={m.status} className="input"><option value="PENDING_REVIEW">Pending review</option><option value="APPROVED">Approved</option><option value="ARCHIVED">Archived</option><option value="DO_NOT_USE">Do not use</option></select></Field>
                        <Field label="Folder"><select name="folder" defaultValue={m.folder} className="input">{FOLDERS.map((f) => <option key={f} value={f}>{pretty(f)}</option>)}</select></Field>
                        <Field label="Tags"><input name="tags" defaultValue={m.tags.join(", ")} className="input" /></Field>
                        <Field label="Alt text"><input name="altText" defaultValue={m.altText ?? ""} className="input" /></Field>
                        <div className="flex gap-4 text-sm">
                          <label className="flex items-center gap-1.5"><input type="checkbox" name="approvedForGbp" defaultChecked={m.approvedForGbp} /> Approved for GBP</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" name="approvedForBlog" defaultChecked={m.approvedForBlog} /> Blog</label>
                          <label className="flex items-center gap-1.5"><input type="checkbox" name="approvedForAds" defaultChecked={m.approvedForAds} /> Ads</label>
                        </div>
                        {m.aiImage && <p className="rounded-lg bg-ink-50 p-2 text-[11px] text-ink-600">Prompt: {m.aiImage.prompt}</p>}
                        <SubmitButton>Save</SubmitButton>
                      </ActionForm>
                    </Dialog>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : <Card><EmptyState title="No media" description="Upload real business photos — the AI prioritizes approved real images over generated ones." /></Card>}
      </div>
    </div>
  );
}

async function MemoryTab({ clientId }: { clientId: string }) {
  const items = await db.contentItem.findMany({ where: { clientId, status: { notIn: ["IDEA", "REJECTED"] } }, orderBy: { createdAt: "desc" }, take: 100, select: { id: true, type: true, title: true, primaryKeyword: true, servicePromoted: true, cta: true, imageId: true, publishedAt: true, scheduledFor: true } });
  const counts = new Map<string, number>();
  for (const i of items) if (i.servicePromoted) counts.set(i.servicePromoted, (counts.get(i.servicePromoted) ?? 0) + 1);
  return (
    <div className="grid gap-5 lg:grid-cols-3">
      <Card title="Services promoted" subtitle="The engine rotates toward under-promoted and priority services">
        <ul className="space-y-2 text-sm">{[...counts.entries()].sort((a, b) => b[1] - a[1]).map(([s, n]) => <li key={s} className="flex justify-between"><span>{s}</span><span className="font-medium">{n}</span></li>)}</ul>
      </Card>
      <Card title="Content history" subtitle="Compared against before generating anything new to avoid repetition" className="lg:col-span-2" pad={false}>
        <table className="w-full"><thead className="bg-ink-50/60"><tr>{["Date", "Type", "Title / topic", "Keyword", "Service", "CTA", "Image"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{items.map((i) => <tr key={i.id} className="tr text-xs"><td className="td">{fmtDate(i.publishedAt ?? i.scheduledFor)}</td><td className="td">{pretty(i.type)}</td><td className="td max-w-[240px] truncate">{i.title}</td><td className="td">{i.primaryKeyword ?? "—"}</td><td className="td">{i.servicePromoted ?? "—"}</td><td className="td">{i.cta ?? "—"}</td><td className="td">{i.imageId ? "✓" : "—"}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}
