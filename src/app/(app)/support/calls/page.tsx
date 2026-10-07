import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, fmtDate } from "@/components/ui";
import { Dialog } from "@/components/client";
import { CallForm } from "@/components/forms";
import { SupportNav } from "@/components/support-nav";
import { pretty } from "@/lib/labels";

export const metadata = { title: "Calls" };

export default async function CallsPage({ searchParams }: { searchParams: Promise<{ mine?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const mine = ctx.experience === "support" || sp.mine === "1";
  const [calls, names, clients] = await Promise.all([
    db.supportCall.findMany({ where: { ...scope, ...(mine ? { createdById: ctx.memberId } : {}) }, orderBy: { occurredAt: "desc" }, take: 200, include: { client: { select: { id: true, name: true } } } }),
    memberNames(ctx.orgId),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Calls" subtitle={mine ? "Calls you logged" : "All logged calls"} actions={ctx.can("add_calls") && <Dialog trigger="+ Add Call" title="Log a call" triggerClassName="btn-primary" wide><CallForm clients={clients} /></Dialog>} />
      {ctx.experience !== "support" && <SupportNav active="/support/calls" manager={ctx.can("view_support_performance")} />}
      <Card pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["When", "Client", "Direction", "Result", "Purpose", "Outcome", "Follow-up", "By"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {calls.map((c) => (
              <tr key={c.id} className="tr text-sm">
                <td className="td whitespace-nowrap text-xs">{fmtDate(c.occurredAt, true)}</td>
                <td className="td"><Link href={`/clients/${c.clientId}/support?tab=calls`} className="font-medium hover:text-brand-700">{c.client.name}</Link></td>
                <td className="td text-xs">{pretty(c.direction)}</td>
                <td className="td"><Badge tone={c.outcome === "ANSWERED" ? "green" : "amber"}>{pretty(c.outcome)}</Badge></td>
                <td className="td max-w-[200px] truncate">{c.purpose}</td>
                <td className="td max-w-[220px] truncate text-xs text-ink-500">{c.result ?? c.discussion}</td>
                <td className="td text-xs">{c.followUpRequired ? fmtDate(c.followUpDate) : "—"}</td>
                <td className="td text-xs">{names.get(c.createdById)?.name}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!calls.length && <EmptyState title="No calls yet" />}
      </Card>
    </>
  );
}
