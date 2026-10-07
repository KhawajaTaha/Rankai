import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays } from "@/lib/utils";
import { Avatar, Card, PageHeader } from "@/components/ui";
import { SupportNav } from "@/components/support-nav";

export const metadata = { title: "Support performance" };

export default async function PerformancePage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("view_support_performance")) redirect("/support");
  const sp = await searchParams;
  const days = [7, 30, 90].includes(Number(sp.days)) ? Number(sp.days) : 30;
  const since = addDays(new Date(), -days);
  const agents = await db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { key: { in: ["support_agent", "support_manager"] } } }, include: { user: true } });
  const rows = await Promise.all(agents.map(async (a) => {
    const [calls, answered, fuDone, fuOverdue, notes, closed, tickets, clients] = await Promise.all([
      db.supportCall.count({ where: { createdById: a.id, occurredAt: { gte: since } } }),
      db.supportCall.count({ where: { createdById: a.id, occurredAt: { gte: since }, outcome: "ANSWERED" } }),
      db.followUp.count({ where: { assignedToId: a.id, completedAt: { gte: since } } }),
      db.followUp.count({ where: { assignedToId: a.id, completedAt: null, dueAt: { lt: new Date() } } }),
      db.supportNote.count({ where: { createdById: a.id, createdAt: { gte: since } } }),
      db.supportTicket.count({ where: { assignedToId: a.id, resolvedAt: { gte: since } } }),
      db.supportTicket.findMany({ where: { assignedToId: a.id, firstResponseAt: { not: null }, createdAt: { gte: since } }, select: { createdAt: true, firstResponseAt: true } }),
      db.clientAssignment.count({ where: { memberId: a.id, type: "SUPPORT" } }),
    ]);
    const avgResp = tickets.length ? tickets.reduce((s, t) => s + (t.firstResponseAt!.getTime() - t.createdAt.getTime()), 0) / tickets.length / 3600_000 : null;
    return { a, calls, answered, fuDone, fuOverdue, notes, closed, avgResp, clients };
  }));
  return (
    <>
      <PageHeader title="Support performance" subtitle="Workflow and service-delivery metrics — focused on keeping clients served, not on surveillance" actions={<form><select name="days" defaultValue={days} className="input h-9 w-auto"><option value="7">7 days</option><option value="30">30 days</option><option value="90">90 days</option></select> <button className="btn-secondary h-9">Apply</button></form>} />
      <SupportNav active="/support/performance" manager />
      <Card pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["Agent", "Clients managed", "Calls logged", "Calls answered", "Follow-ups completed", "Overdue follow-ups", "Notes added", "Requests resolved", "Avg first response"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.a.id} className="tr text-sm">
                <td className="td"><span className="flex items-center gap-2"><Avatar name={r.a.user.name} size={28} />{r.a.user.name}</span></td>
                <td className="td">{r.clients}</td><td className="td">{r.calls}</td><td className="td">{r.answered}</td><td className="td">{r.fuDone}</td>
                <td className={`td ${r.fuOverdue ? "font-medium text-red-600" : ""}`}>{r.fuOverdue}</td><td className="td">{r.notes}</td><td className="td">{r.closed}</td>
                <td className="td">{r.avgResp == null ? "—" : `${r.avgResp.toFixed(1)}h`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
