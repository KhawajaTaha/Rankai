import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, severityTone, timeAgo } from "@/components/ui";
import { ActionForm, Dialog, Field, SubmitButton } from "@/components/client";
import { SupportNav } from "@/components/support-nav";
import { createTicketAction } from "@/app/actions/support";
import { cn } from "@/lib/utils";
import { pretty } from "@/lib/labels";

export const metadata = { title: "Client Requests" };

export default async function TicketsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const status = sp.status ?? "open";
  const [tickets, names, clients] = await Promise.all([
    db.supportTicket.findMany({ where: { ...scope, ...(status === "open" ? { status: { in: ["OPEN", "IN_PROGRESS", "WAITING_FOR_CLIENT"] } } : status === "closed" ? { status: { in: ["RESOLVED", "CLOSED"] } } : {}), ...(ctx.experience === "support" && !ctx.can("manage_support") ? { OR: [{ assignedToId: ctx.memberId }, { assignedToId: null }] } : {}) }, orderBy: [{ slaDueAt: "asc" }], include: { client: { select: { name: true } } }, take: 200 }),
    memberNames(ctx.orgId),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Client Requests" subtitle="Tickets with SLA timers — from the client portal or created by staff" actions={ctx.can("manage_tickets") && (
        <Dialog trigger="+ New request" title="New client request" triggerClassName="btn-primary">
          <ActionForm action={createTicketAction} className="grid gap-3">
            <Field label="Client"><select name="clientId" className="input">{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></Field>
            <Field label="Type"><select name="type" className="input">{["WEBSITE_CHANGE", "GBP_CHANGE", "NEW_SERVICE", "CONTENT_REQUEST", "BILLING", "TECHNICAL_PROBLEM", "OTHER"].map((t) => <option key={t} value={t}>{pretty(t)}</option>)}</select></Field>
            <Field label="Subject"><input name="subject" className="input" /></Field>
            <Field label="Description"><textarea name="description" rows={4} className="input" /></Field>
            <Field label="Priority"><select name="priority" defaultValue="NORMAL" className="input">{["LOW", "NORMAL", "HIGH", "URGENT"].map((p) => <option key={p} value={p}>{p.toLowerCase()}</option>)}</select></Field>
            <Field label="Requested by"><input name="requestedBy" className="input" /></Field>
            <SubmitButton>Create</SubmitButton>
          </ActionForm>
        </Dialog>
      )} />
      {ctx.experience !== "support" && <SupportNav active="/support/tickets" manager={ctx.can("view_support_performance")} />}
      <div className="mb-4 flex gap-2">{[["open", "Open"], ["closed", "Resolved"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`?status=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", status === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>{l}</Link>)}</div>
      <Card pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["#", "Request", "Client", "Type", "Priority", "Assigned", "SLA", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {tickets.map((t) => {
              const breached = !t.firstResponseAt && t.slaDueAt && t.slaDueAt < new Date() && ["OPEN", "IN_PROGRESS"].includes(t.status);
              return (
                <tr key={t.id} className="tr text-sm">
                  <td className="td text-xs text-ink-500">{t.number}</td>
                  <td className="td"><Link href={`/support/tickets/${t.id}`} className="font-medium hover:text-brand-700">{t.subject}</Link><div className="text-xs text-ink-500">{t.requestedBy} · {timeAgo(t.createdAt)}</div></td>
                  <td className="td">{t.client.name}</td>
                  <td className="td text-xs">{pretty(t.type)}</td>
                  <td className="td"><Badge tone={severityTone(t.priority)}>{t.priority.toLowerCase()}</Badge></td>
                  <td className="td text-xs">{names.get(t.assignedToId ?? "")?.name ?? "—"}</td>
                  <td className="td text-xs">{t.firstResponseAt ? <Badge tone="green">responded</Badge> : breached ? <Badge tone="red">overdue {timeAgo(t.slaDueAt)}</Badge> : `due ${timeAgo(t.slaDueAt)}`}</td>
                  <td className="td"><StatusBadge status={t.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!tickets.length && <EmptyState title="No requests" />}
      </Card>
    </>
  );
}
