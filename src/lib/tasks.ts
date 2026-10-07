import type { Priority, TaskSource } from "@prisma/client";
import { db } from "./db";
import { activity, type Actor } from "./audit";
import { notify } from "./notify";
import { addHours } from "./utils";

const DUE_HOURS: Record<Priority, number> = { URGENT: 4, HIGH: 24, NORMAL: 72, LOW: 168 };

/** Category → which assignment type should own the task by default. */
const OWNER_BY_CATEGORY: Record<string, "SUPPORT" | "SEO" | "CONTENT"> = {
  Onboarding: "SUPPORT",
  Support: "SUPPORT",
  "Follow-Up": "SUPPORT",
  Review: "SUPPORT",
  GBP: "SEO",
  SEO: "SEO",
  Website: "SEO",
  Technical: "SEO",
  Rankings: "SEO",
  Content: "CONTENT",
  Approval: "SEO",
  Integration: "SUPPORT",
};

export async function defaultAssignee(clientId: string | null | undefined, category: string): Promise<string | null> {
  if (!clientId) return null;
  const want = OWNER_BY_CATEGORY[category] ?? "SUPPORT";
  const rows = await db.clientAssignment.findMany({ where: { clientId }, orderBy: { createdAt: "asc" } });
  return (
    rows.find((r) => r.type === want)?.memberId ??
    rows.find((r) => r.type === "SUPPORT")?.memberId ??
    rows.find((r) => r.type === "SEO")?.memberId ??
    rows[0]?.memberId ??
    null
  );
}

/**
 * Create a task. When dedupeKey is given the task is idempotent: an existing non-closed task with
 * the same key is returned instead of creating a duplicate (automation can call this repeatedly).
 */
export async function createTask(args: {
  organizationId: string;
  clientId?: string | null;
  title: string;
  description?: string;
  category?: string;
  priority?: Priority;
  dueAt?: Date;
  assignedToId?: string | null;
  source?: TaskSource;
  sourceRef?: string;
  dedupeKey?: string;
  createdById?: string | null;
  actor?: Actor;
  notifyAssignee?: boolean;
}) {
  const category = args.category ?? "General";
  const priority = args.priority ?? "NORMAL";
  if (args.dedupeKey) {
    const existing = await db.task.findUnique({ where: { organizationId_dedupeKey: { organizationId: args.organizationId, dedupeKey: args.dedupeKey } } });
    if (existing && !["COMPLETED", "CANCELLED"].includes(existing.status)) return { task: existing, created: false };
    if (existing) {
      // Re-open a closed recurring issue rather than violating the unique key.
      const task = await db.task.update({
        where: { id: existing.id },
        data: { status: "OPEN", completedAt: null, priority, dueAt: args.dueAt ?? addHours(new Date(), DUE_HOURS[priority]), description: args.description ?? existing.description },
      });
      return { task, created: true };
    }
  }
  const assignedToId = args.assignedToId !== undefined ? args.assignedToId : await defaultAssignee(args.clientId, category);
  const task = await db.task.create({
    data: {
      organizationId: args.organizationId,
      clientId: args.clientId ?? null,
      title: args.title,
      description: args.description,
      category,
      priority,
      dueAt: args.dueAt ?? addHours(new Date(), DUE_HOURS[priority]),
      assignedToId,
      source: args.source ?? "HUMAN",
      sourceRef: args.sourceRef,
      dedupeKey: args.dedupeKey,
      createdById: args.createdById ?? null,
    },
  });
  if (args.clientId) {
    await activity({
      organizationId: args.organizationId,
      clientId: args.clientId,
      category: "SYSTEM",
      type: "task.created",
      title: `Task created: ${args.title}`,
      actor: args.actor ?? { type: args.source === "HUMAN" ? "HUMAN" : "AUTOMATION", name: args.source === "HUMAN" ? undefined : "Automation" },
      entityType: "Task",
      entityId: task.id,
    });
  }
  if (assignedToId && args.notifyAssignee !== false && assignedToId !== args.createdById) {
    await notify({
      organizationId: args.organizationId,
      recipientIds: [assignedToId],
      clientId: args.clientId,
      type: "task.assigned",
      title: `New task: ${args.title}`,
      link: `/tasks?task=${task.id}`,
      severity: priority === "URGENT" ? "HIGH" : priority === "HIGH" ? "MEDIUM" : "LOW",
    });
  }
  return { task, created: true };
}

export async function completeTasksByDedupe(organizationId: string, dedupeKey: string) {
  await db.task.updateMany({
    where: { organizationId, dedupeKey, status: { notIn: ["COMPLETED", "CANCELLED"] } },
    data: { status: "COMPLETED", completedAt: new Date() },
  });
}
