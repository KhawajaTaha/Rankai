import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { addDays, startOfDay } from "@/lib/utils";
import { PageHeader, Stat } from "@/components/ui";
import { SupportNav } from "@/components/support-nav";

export const metadata = { title: "Support" };

export default async function SupportOverview() {
  const ctx = await requireStaff();
  if (ctx.experience === "support") redirect("/dashboard");
  const scope = await clientScopeFilter(ctx);
  const today = startOfDay();
  const [callsToday, callsWeek, overdue, dueToday, open, breached, notes] = await Promise.all([
    db.supportCall.count({ where: { ...scope, occurredAt: { gte: today } } }),
    db.supportCall.count({ where: { ...scope, occurredAt: { gte: addDays(today, -7) } } }),
    db.followUp.count({ where: { ...scope, completedAt: null, dueAt: { lt: new Date() } } }),
    db.followUp.count({ where: { ...scope, completedAt: null, dueAt: { gte: new Date(), lt: addDays(today, 1) } } }),
    db.supportTicket.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    db.supportTicket.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] }, firstResponseAt: null, slaDueAt: { lt: new Date() } } }),
    db.supportNote.count({ where: { ...scope, createdAt: { gte: addDays(today, -7) } } }),
  ]);
  return (
    <>
      <PageHeader title="Support" subtitle="Calls, notes, follow-ups and client requests" />
      <SupportNav active="/support" manager={ctx.can("view_support_performance")} />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Calls today" value={callsToday} hint={`${callsWeek} this week`} href="/support/calls" />
        <Stat label="Follow-ups overdue" value={overdue} tone={overdue ? "red" : "green"} href="/support/follow-ups" />
        <Stat label="Follow-ups due today" value={dueToday} tone={dueToday ? "amber" : undefined} href="/support/follow-ups" />
        <Stat label="Open client requests" value={open} hint={`${breached} past SLA`} tone={breached ? "red" : undefined} href="/support/tickets" />
        <Stat label="Notes this week" value={notes} href="/support/notes" />
      </div>
    </>
  );
}
