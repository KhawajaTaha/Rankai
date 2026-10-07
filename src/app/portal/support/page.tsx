import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader, StatusBadge, fmtDate } from "@/components/ui";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { portalReplyAction, portalRequestHelpAction } from "@/app/actions/portal";
import { pretty } from "@/lib/labels";

export const metadata = { title: "Support" };

export default async function PortalSupport() {
  const ctx = await requirePortal();
  const [tickets, notes] = await Promise.all([
    db.supportTicket.findMany({ where: { clientId: ctx.portalClientId }, orderBy: { createdAt: "desc" }, include: { messages: { where: { NOT: { authorName: { contains: "(internal)" } } }, orderBy: { createdAt: "asc" } } } }),
    db.supportNote.findMany({ where: { clientId: ctx.portalClientId, visibility: "CLIENT_VISIBLE" }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return (
    <>
      <PageHeader title="Support" subtitle="Ask for help or a change — your support agent is notified right away" />
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          {tickets.map((t) => (
            <Card key={t.id} title={`#${t.number} ${t.subject}`} subtitle={`${pretty(t.type)} · ${fmtDate(t.createdAt)}`} actions={<StatusBadge status={t.status} />}>
              <div className="space-y-2">{t.messages.map((m) => <div key={m.id} className={`rounded-xl p-3 text-sm ${m.fromClient ? "bg-ink-50" : "bg-brand-50/60"}`}><div className="mb-0.5 text-xs text-ink-500">{m.authorName} · {fmtDate(m.createdAt, true)}</div>{m.body}</div>)}</div>
              {!["CLOSED"].includes(t.status) && ctx.can("portal_request_help") && (
                <ActionForm action={portalReplyAction.bind(null, t.id)} className="mt-3 flex gap-2"><input name="body" className="input" placeholder="Reply…" /><SubmitButton className="btn-secondary">Send</SubmitButton></ActionForm>
              )}
            </Card>
          ))}
          {!tickets.length && <Card><EmptyState title="No requests yet" /></Card>}
        </div>
        <div className="space-y-5">
          {ctx.can("portal_request_help") && (
            <Card title="Request Help">
              <ActionForm action={portalRequestHelpAction} className="space-y-3">
                <Field label="What do you need?"><select name="type" className="input">{[["WEBSITE_CHANGE", "Website change"], ["GBP_CHANGE", "Google Business change"], ["NEW_SERVICE", "New service"], ["CONTENT_REQUEST", "Content request"], ["BILLING", "Billing"], ["TECHNICAL_PROBLEM", "Technical problem"], ["OTHER", "Other"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
                <Field label="Subject"><input name="subject" className="input" /></Field>
                <Field label="Details"><textarea name="description" rows={4} className="input" /></Field>
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="urgent" className="h-4 w-4 rounded" /> This is urgent</label>
                <SubmitButton className="btn-primary w-full">Send request</SubmitButton>
              </ActionForm>
            </Card>
          )}
          {notes.length > 0 && <Card title="Notes from your team" pad={false}><ul className="divide-y divide-ink-100">{notes.map((n) => <li key={n.id} className="px-5 py-2.5 text-sm">{n.body}<div className="text-xs text-ink-400">{fmtDate(n.createdAt)}</div></li>)}</ul></Card>}
        </div>
      </div>
    </>
  );
}
