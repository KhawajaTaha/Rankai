import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Card } from "@/components/ui";
import { Dialog } from "@/components/client";
import { TaskForm } from "@/components/forms";
import { TaskTable } from "@/components/task-table";

export default async function ClientTasks({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  await getAccessibleClient(ctx, id);
  const [tasks, names, members] = await Promise.all([
    db.task.findMany({ where: { clientId: id }, orderBy: [{ status: "asc" }, { dueAt: "asc" }], take: 300, include: { client: { select: { id: true, name: true } }, comments: { orderBy: { createdAt: "asc" } }, dependsOn: { select: { title: true, status: true } } } }),
    memberNames(ctx.orgId),
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { isClientRole: false } }, include: { user: true } }),
  ]);
  return (
    <Card title="Tasks" pad={false} actions={ctx.can("create_tasks") && <Dialog trigger="+ Create Task" title="Create a task" triggerClassName="btn-primary btn-sm" wide><TaskForm clientId={id} members={members.map((m) => ({ id: m.id, name: m.user.name }))} /></Dialog>}>
      <TaskTable tasks={tasks} names={names} showClient={false} />
    </Card>
  );
}
