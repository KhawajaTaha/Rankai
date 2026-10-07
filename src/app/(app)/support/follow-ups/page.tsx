import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, fmtDate } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { SupportNav } from "@/components/support-nav";
import { completeFollowUpAction } from "@/app/actions/clients";

export const metadata = { title: "Follow-Ups" };

export default async function FollowUpsPage() {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const mine = ctx.experience === "support";
  const [rows, names] = await Promise.all([
    db.followUp.findMany({ where: { ...scope, completedAt: null, ...(mine ? { assignedToId: ctx.memberId } : {}) }, orderBy: { dueAt: "asc" }, include: { client: { select: { id: true, name: true, phone: true } } } }),
    memberNames(ctx.orgId),
  ]);
  return (
    <>
      <PageHeader title="Follow-Ups" subtitle="Overdue follow-ups notify the agent, then escalate to the Support Manager after 24h" />
      {!mine && <SupportNav active="/support/follow-ups" manager={ctx.can("view_support_performance")} />}
      <Card pad={false}>
        <ul className="divide-y divide-ink-100">
          {rows.map((f) => {
            const overdue = f.dueAt < new Date();
            return (
              <li key={f.id} className="flex flex-wrap items-center gap-3 px-5 py-3">
                <div className="min-w-0 flex-1">
                  <Link href={`/clients/${f.clientId}/support`} className="font-medium hover:text-brand-700">{f.client.name}</Link>
                  <div className="text-xs text-ink-500">{f.title}{f.client.phone ? ` · ${f.client.phone}` : ""} · {names.get(f.assignedToId ?? "")?.name ?? "Unassigned"}</div>
                </div>
                <span className="text-xs">{fmtDate(f.dueAt, true)}</span>
                <Badge tone={overdue ? "red" : "amber"}>{overdue ? (f.escalatedAt ? "Escalated" : "Overdue") : "Upcoming"}</Badge>
                {ctx.can("add_calls") && <ActionButton action={completeFollowUpAction.bind(null, f.id)}>Mark done</ActionButton>}
              </li>
            );
          })}
        </ul>
        {!rows.length && <EmptyState title="No open follow-ups" description="You're all caught up." />}
      </Card>
    </>
  );
}
