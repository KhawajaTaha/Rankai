import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Card, PageHeader } from "@/components/ui";
import { Dialog } from "@/components/client";
import { TaskForm } from "@/components/forms";
import { TaskTable } from "@/components/task-table";
import { cn } from "@/lib/utils";

export const metadata = { title: "Tasks" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ filter?: string; source?: string; task?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const filter = sp.filter ?? (ctx.experience === "support" ? "mine" : "open");
  const where: Prisma.TaskWhereInput = { organizationId: ctx.orgId, OR: [{ clientId: null }, scope.clientId ? { clientId: scope.clientId } : { clientId: { not: null } }] };
  if (filter === "mine") Object.assign(where, { assignedToId: ctx.memberId, status: { notIn: ["COMPLETED", "CANCELLED"] } });
  if (filter === "open") where.status = { notIn: ["COMPLETED", "CANCELLED"] };
  if (filter === "overdue") Object.assign(where, { status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { lt: new Date() } });
  if (filter === "waiting") where.status = { in: ["WAITING_FOR_CLIENT", "WAITING_FOR_APPROVAL", "BLOCKED"] };
  if (filter === "done") where.status = "COMPLETED";
  if (sp.source) where.source = sp.source as "AI";
  if (sp.task) Object.assign(where, { id: sp.task, status: undefined, assignedToId: undefined });
  const [tasks, names, clients, members] = await Promise.all([
    db.task.findMany({ where, orderBy: [{ priority: "desc" }, { dueAt: "asc" }], take: 300, include: { client: { select: { id: true, name: true } }, comments: { orderBy: { createdAt: "asc" } }, dependsOn: { select: { title: true, status: true } } } }),
    memberNames(ctx.orgId),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { isClientRole: false } }, include: { user: true } }),
  ]);
  const F = [["mine", "My tasks"], ["open", "All open"], ["overdue", "Overdue"], ["waiting", "Waiting / blocked"], ["done", "Completed"]];
  const SOURCES = ["HUMAN", "AI", "AUTOMATION", "CLIENT_REQUEST", "SEO_AUDIT", "SUPPORT_NOTE", "REVIEW_ALERT", "WATCHDOG", "ONBOARDING"];
  return (
    <>
      <PageHeader title="Tasks" subtitle="Created by people, AI, automations, client requests, audits and review alerts" actions={ctx.can("create_tasks") && <Dialog trigger="+ Create Task" title="Create a task" triggerClassName="btn-primary" wide><TaskForm clients={clients} members={members.map((m) => ({ id: m.id, name: m.user.name }))} /></Dialog>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {F.map(([k, l]) => <Link key={k} href={`/tasks?filter=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", filter === k && !sp.source ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>{l}</Link>)}
        <form className="ml-auto"><input type="hidden" name="filter" value={filter} /><select name="source" defaultValue={sp.source ?? ""} className="input h-8 w-auto py-1 text-xs"><option value="">Any source</option>{SOURCES.map((s) => <option key={s} value={s}>{s.replace("_", " ").toLowerCase()}</option>)}</select> <button className="btn-secondary btn-sm">Apply</button></form>
      </div>
      <Card pad={false}><TaskTable tasks={tasks} names={names} openId={sp.task} /></Card>
    </>
  );
}
