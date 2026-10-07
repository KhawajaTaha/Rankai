import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientWhere } from "@/lib/tenancy";
import { Badge, Card, KeyValue, PageHeader, StatusBadge, fmtDate, severityTone, timeAgo } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { replyTicketAction, updateTicketAction } from "@/app/actions/support";
import { pretty } from "@/lib/labels";

export default async function TicketPage({ params }: { params: Promise<{ ticketId: string }> }) {
  const ctx = await requireStaff();
  const { ticketId } = await params;
  const t = await db.supportTicket.findFirst({ where: { id: ticketId, client: clientWhere(ctx) }, include: { client: true, messages: { orderBy: { createdAt: "asc" } } } });
  if (!t) notFound();
  const members = await db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { isClientRole: false } }, include: { user: true } });
  const can = ctx.can("manage_tickets");
  return (
    <>
      <PageHeader eyebrow={<Link href={`/clients/${t.clientId}/support?tab=requests`} className="link">{t.client.name}</Link>} title={`#${t.number} ${t.subject}`} subtitle={<span className="inline-flex gap-2"><StatusBadge status={t.status} /><Badge tone={severityTone(t.priority)}>{t.priority.toLowerCase()}</Badge><Badge>{pretty(t.type)}</Badge></span>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {t.messages.map((m) => (
            <div key={m.id} className={`card p-4 ${m.fromClient ? "" : "border-brand-100 bg-brand-50/30"} ${m.authorName.includes("(internal)") ? "border-amber-200 bg-amber-50/40" : ""}`}>
              <div className="mb-1 text-xs text-ink-500"><span className="font-medium text-ink-800">{m.authorName}</span> · {fmtDate(m.createdAt, true)}</div>
              <p className="whitespace-pre-wrap text-sm text-ink-800">{m.body}</p>
            </div>
          ))}
          {can && (
            <Card title="Reply">
              <ActionForm action={replyTicketAction.bind(null, t.id)} className="space-y-3">
                <textarea name="body" rows={4} className="input" placeholder="Reply to the client, or add an internal note (@mention teammates)" />
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="internal" className="h-4 w-4 rounded" /> Internal note</label>
                  <select name="status" defaultValue="" className="input h-8 w-auto py-1 text-xs"><option value="">Keep status</option>{["IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED", "CLOSED"].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select>
                  <SubmitButton className="btn-primary btn-sm">Send</SubmitButton>
                </div>
              </ActionForm>
            </Card>
          )}
        </div>
        <div className="space-y-5">
          <Card title="Details">
            <KeyValue items={[{ label: "Requested by", value: t.requestedBy }, { label: "Created", value: fmtDate(t.createdAt, true) }, { label: "SLA response due", value: t.slaDueAt ? `${fmtDate(t.slaDueAt, true)} (${timeAgo(t.slaDueAt)})` : "—" }, { label: "First response", value: t.firstResponseAt ? fmtDate(t.firstResponseAt, true) : "Not yet" }, { label: "Resolved", value: t.resolvedAt ? fmtDate(t.resolvedAt, true) : "—" }]} />
          </Card>
          {can && (
            <Card title="Update">
              <ActionForm action={updateTicketAction.bind(null, t.id)} resetOnSuccess={false} className="space-y-3">
                <Field label="Status"><select name="status" defaultValue={t.status} className="input">{["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT", "RESOLVED", "CLOSED"].map((s) => <option key={s} value={s}>{pretty(s)}</option>)}</select></Field>
                <Field label="Priority"><select name="priority" defaultValue={t.priority} className="input">{["LOW", "NORMAL", "HIGH", "URGENT"].map((s) => <option key={s} value={s}>{s.toLowerCase()}</option>)}</select></Field>
                <Field label="Assigned to"><select name="assignedToId" defaultValue={t.assignedToId ?? ""} className="input"><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name}</option>)}</select></Field>
                <SubmitButton className="btn-secondary">Save</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}
