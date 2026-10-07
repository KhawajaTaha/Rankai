import type { CallDirection, CallOutcome, NoteVisibility, Priority, SupportHealth, TicketType } from "@prisma/client";
import { db } from "../db";
import { activity, audit, type Actor } from "../audit";
import { membersWithRole, notify } from "../notify";
import { createTask, defaultAssignee } from "../tasks";
import { addDays, addHours } from "../utils";

type StaffActor = Actor & { memberId: string; orgId: string };

/** Manual call logging (spec §43) with follow-up automation (spec §44). */
export async function logCall(actor: StaffActor, input: {
  clientId: string;
  contactName?: string;
  occurredAt: Date;
  direction: CallDirection;
  outcome: CallOutcome;
  durationMin?: number | null;
  purpose?: string;
  discussion?: string;
  result?: string;
  followUpRequired: boolean;
  followUpDate?: Date | null;
  tags: string[];
}) {
  const call = await db.supportCall.create({
    data: {
      organizationId: actor.orgId,
      clientId: input.clientId,
      contactName: input.contactName,
      occurredAt: input.occurredAt,
      direction: input.direction,
      outcome: input.outcome,
      durationMin: input.durationMin ?? null,
      purpose: input.purpose,
      discussion: input.discussion,
      result: input.result,
      followUpRequired: input.followUpRequired,
      followUpDate: input.followUpDate ?? null,
      tags: input.tags,
      createdById: actor.memberId,
    },
  });
  const clientUpdate: { lastContactAt?: Date; nextFollowUpAt?: Date } = {};
  if (input.outcome === "ANSWERED") clientUpdate.lastContactAt = input.occurredAt;
  if (input.followUpRequired) {
    const dueAt = input.followUpDate ?? addDays(new Date(), 2);
    const { task } = await createTask({
      organizationId: actor.orgId,
      clientId: input.clientId,
      title: `Follow up: ${input.purpose || "call"}`,
      description: [input.discussion, input.result && `Outcome: ${input.result}`].filter(Boolean).join("\n\n"),
      category: "Follow-Up",
      priority: "NORMAL",
      dueAt,
      assignedToId: actor.memberId,
      source: "HUMAN",
      sourceRef: call.id,
      createdById: actor.memberId,
      notifyAssignee: false,
    });
    await db.followUp.create({ data: { organizationId: actor.orgId, clientId: input.clientId, title: task.title, dueAt, assignedToId: actor.memberId, sourceCallId: call.id, taskId: task.id } });
    clientUpdate.nextFollowUpAt = await nextFollowUpDate(input.clientId, dueAt);
  }
  await db.client.update({ where: { id: input.clientId }, data: clientUpdate });
  await activity({ organizationId: actor.orgId, clientId: input.clientId, category: "SUPPORT", type: "call.logged", title: `${input.direction === "INCOMING" ? "Incoming" : "Outgoing"} call — ${input.outcome.replace("_", " ").toLowerCase()}`, detail: input.purpose, actor, entityType: "SupportCall", entityId: call.id });
  await audit({ organizationId: actor.orgId, clientId: input.clientId, actor, action: "call.create", entityType: "SupportCall", entityId: call.id, newValue: input, source: "ui" });
  await updateSupportHealth(input.clientId);
  return call;
}

async function nextFollowUpDate(clientId: string, candidate?: Date) {
  const f = await db.followUp.findFirst({ where: { clientId, completedAt: null }, orderBy: { dueAt: "asc" } });
  if (!f) return candidate;
  return candidate && candidate < f.dueAt ? candidate : f.dueAt;
}

/**
 * Support notes (spec §45). "Use as AI context" feeds the Client Knowledge Brain (spec §12),
 * and @mentions notify colleagues (spec §78).
 */
export async function addNote(actor: StaffActor, input: {
  clientId: string;
  body: string;
  category: string;
  priority: Priority;
  visibility: NoteVisibility;
  useAsAiContext: boolean;
  pinned?: boolean;
  attachmentUrl?: string | null;
}) {
  const note = await db.supportNote.create({ data: { organizationId: actor.orgId, ...input, pinned: input.pinned ?? false, createdById: actor.memberId } });
  if (input.useAsAiContext) {
    await db.knowledgeEntry.create({ data: { organizationId: actor.orgId, clientId: input.clientId, source: "support_note", sourceId: note.id, content: input.body, priority: input.priority === "HIGH" || input.priority === "URGENT" ? 2 : 1, createdById: actor.memberId } });
    await db.clientKnowledge.updateMany({ where: { clientId: input.clientId }, data: { version: { increment: 1 } } });
    await activity({ organizationId: actor.orgId, clientId: input.clientId, category: "AI", type: "knowledge.updated", title: "AI Business Brain updated from support note", actor });
  }
  await processMentions(actor, input.body, { clientId: input.clientId, entityType: "SupportNote", entityId: note.id, link: `/clients/${input.clientId}/support` });
  await activity({ organizationId: actor.orgId, clientId: input.clientId, category: "SUPPORT", type: "note.added", title: `Note added (${input.category})`, detail: input.body.slice(0, 200), actor, entityType: "SupportNote", entityId: note.id });
  await audit({ organizationId: actor.orgId, clientId: input.clientId, actor, action: "note.create", entityType: "SupportNote", entityId: note.id, newValue: input, source: "ui" });
  return note;
}

/** Parse @Name / @role mentions and notify matching members. */
export async function processMentions(actor: StaffActor, text: string, ref: { clientId?: string | null; entityType: string; entityId: string; link: string }) {
  const tokens = [...text.matchAll(/@([A-Za-z][A-Za-z0-9_.-]{1,40})/g)].map((m) => m[1]!.toLowerCase());
  if (!tokens.length) return [];
  const members = await db.organizationUser.findMany({ where: { organizationId: actor.orgId, status: "ACTIVE" }, include: { user: true, role: true } });
  const roleAliases: Record<string, string[]> = {
    seomanager: ["seo_manager"], supportagent: ["support_agent"], supportmanager: ["support_manager"], contentteam: ["content_manager"], seo: ["seo_manager", "seo_specialist"], admins: ["agency_admin"],
  };
  const ids = new Set<string>();
  for (const t of tokens) {
    const norm = t.replace(/[^a-z0-9]/g, "");
    const roles = roleAliases[norm];
    for (const m of members) {
      const first = m.user.name.split(" ")[0]!.toLowerCase();
      const full = m.user.name.toLowerCase().replace(/[^a-z0-9]/g, "");
      if ((roles && roles.includes(m.role.key)) || first === t || full === norm) ids.add(m.id);
    }
  }
  ids.delete(actor.memberId);
  for (const id of ids) {
    await db.mention.create({ data: { organizationId: actor.orgId, clientId: ref.clientId ?? null, mentionedId: id, authorId: actor.memberId, entityType: ref.entityType, entityId: ref.entityId, excerpt: text.slice(0, 240) } });
  }
  await notify({ organizationId: actor.orgId, recipientIds: [...ids], type: "mention", title: `${actor.name ?? "A teammate"} mentioned you`, body: text.slice(0, 200), link: ref.link, clientId: ref.clientId, severity: "MEDIUM" });
  return [...ids];
}

/** Client requests / tickets with SLA timers (spec §46-47). */
export async function createTicket(args: {
  organizationId: string;
  clientId: string;
  type: TicketType;
  subject: string;
  description: string;
  priority?: Priority;
  requestedBy?: string;
  actor: Actor;
}) {
  const priority = args.priority ?? (args.type === "TECHNICAL_PROBLEM" ? "HIGH" : "NORMAL");
  const sla = await db.slaPolicy.findUnique({ where: { organizationId_priority: { organizationId: args.organizationId, priority } } });
  const assignedToId = await defaultAssignee(args.clientId, "Support");
  const ticket = await db.$transaction(async (tx) => {
    const last = await tx.supportTicket.findFirst({ where: { organizationId: args.organizationId }, orderBy: { number: "desc" }, select: { number: true } });
    return tx.supportTicket.create({
      data: {
        organizationId: args.organizationId,
        clientId: args.clientId,
        number: (last?.number ?? 1000) + 1,
        type: args.type,
        subject: args.subject,
        description: args.description,
        priority,
        assignedToId,
        requestedBy: args.requestedBy,
        slaDueAt: addHours(new Date(), sla?.respondWithinHours ?? 24),
        messages: { create: { organizationId: args.organizationId, authorName: args.requestedBy ?? "Client", fromClient: args.actor.type === "CLIENT", body: args.description } },
      },
    });
  });
  if (args.type === "NEW_SERVICE" || args.type === "CONTENT_REQUEST") {
    await db.knowledgeEntry.create({ data: { organizationId: args.organizationId, clientId: args.clientId, source: "client_request", sourceId: ticket.id, content: `Client request: ${args.subject} — ${args.description}`.slice(0, 1000), active: false } });
  }
  const recipients = [assignedToId, ...(await membersWithRole(args.organizationId, ["support_manager"]))].filter(Boolean) as string[];
  await notify({ organizationId: args.organizationId, recipientIds: recipients, type: "ticket.new", title: `New client request #${ticket.number}: ${args.subject}`, link: `/support/tickets/${ticket.id}`, clientId: args.clientId, severity: priority === "URGENT" ? "CRITICAL" : priority === "HIGH" ? "HIGH" : "MEDIUM" });
  await activity({ organizationId: args.organizationId, clientId: args.clientId, category: args.actor.type === "CLIENT" ? "CLIENT" : "SUPPORT", type: "ticket.created", title: `Request #${ticket.number}: ${args.subject}`, actor: args.actor, entityType: "SupportTicket", entityId: ticket.id });
  await audit({ organizationId: args.organizationId, clientId: args.clientId, actor: args.actor, action: "ticket.create", entityType: "SupportTicket", entityId: ticket.id, newValue: { subject: args.subject, type: args.type, priority }, source: args.actor.type === "CLIENT" ? "portal" : "ui" });
  await updateSupportHealth(args.clientId);
  return ticket;
}

/**
 * Follow-up reminders and escalation (spec §44): overdue → notify the agent;
 * still overdue after 24h → notify Support Managers.
 */
export async function processFollowUps(organizationId?: string) {
  const now = new Date();
  const overdue = await db.followUp.findMany({ where: { completedAt: null, dueAt: { lt: now }, ...(organizationId ? { organizationId } : {}) }, include: { client: { select: { name: true } } } });
  let reminded = 0;
  let escalated = 0;
  for (const f of overdue) {
    if (!f.remindedAt && f.assignedToId) {
      await notify({ organizationId: f.organizationId, recipientIds: [f.assignedToId], type: "followup.overdue", title: `Follow-up overdue: ${f.client.name}`, body: f.title, link: `/clients/${f.clientId}/support`, clientId: f.clientId, severity: "HIGH" });
      await db.followUp.update({ where: { id: f.id }, data: { remindedAt: now } });
      reminded++;
    } else if (f.remindedAt && !f.escalatedAt && now.getTime() - f.dueAt.getTime() > 24 * 3600_000) {
      const managers = await membersWithRole(f.organizationId, ["support_manager"]);
      await notify({ organizationId: f.organizationId, recipientIds: managers, type: "followup.escalated", title: `Escalation: follow-up overdue 24h+ for ${f.client.name}`, body: f.title, link: `/clients/${f.clientId}/support`, clientId: f.clientId, severity: "HIGH" });
      await db.followUp.update({ where: { id: f.id }, data: { escalatedAt: now } });
      escalated++;
    }
  }
  // Upcoming reminders (due within 2h) for today's work.
  const soon = await db.followUp.findMany({ where: { completedAt: null, remindedAt: null, dueAt: { gte: now, lt: addHours(now, 2) }, ...(organizationId ? { organizationId } : {}) }, include: { client: { select: { name: true } } } });
  for (const f of soon) {
    if (!f.assignedToId) continue;
    await notify({ organizationId: f.organizationId, recipientIds: [f.assignedToId], type: "followup.due", title: `Follow-up due soon: ${f.client.name}`, body: f.title, link: `/clients/${f.clientId}/support`, clientId: f.clientId, severity: "MEDIUM" });
  }
  return { reminded, escalated, upcoming: soon.length };
}

export async function completeFollowUp(followUpId: string, organizationId: string, actor: StaffActor) {
  const f = await db.followUp.findFirstOrThrow({ where: { id: followUpId, organizationId } });
  await db.followUp.update({ where: { id: f.id }, data: { completedAt: new Date() } });
  if (f.taskId) await db.task.update({ where: { id: f.taskId }, data: { status: "COMPLETED", completedAt: new Date() } });
  await db.client.update({ where: { id: f.clientId }, data: { nextFollowUpAt: (await nextFollowUpDate(f.clientId)) ?? null } });
  await activity({ organizationId, clientId: f.clientId, category: "SUPPORT", type: "followup.completed", title: `Follow-up completed: ${f.title}`, actor });
  await updateSupportHealth(f.clientId);
}

/** Support health status shown on the agent dashboard (spec §4). */
export async function updateSupportHealth(clientId: string): Promise<SupportHealth> {
  const now = new Date();
  const c = await db.client.findUniqueOrThrow({ where: { id: clientId } });
  const [urgentTickets, overdueFollowUps, waitingTasks, seoIssues, openFollowUps, criticalAlerts] = await Promise.all([
    db.supportTicket.count({ where: { clientId, status: { in: ["OPEN", "IN_PROGRESS"] }, OR: [{ priority: "URGENT" }, { slaDueAt: { lt: now }, firstResponseAt: null }] } }),
    db.followUp.count({ where: { clientId, completedAt: null, dueAt: { lt: now } } }),
    db.task.count({ where: { clientId, status: "WAITING_FOR_CLIENT" } }),
    db.seoIssue.count({ where: { clientId, status: "OPEN", severity: "CRITICAL" } }),
    db.followUp.count({ where: { clientId, completedAt: null } }),
    db.alert.count({ where: { clientId, status: "OPEN", severity: "CRITICAL" } }),
  ]);
  let health: SupportHealth = "HEALTHY";
  if (urgentTickets || criticalAlerts) health = "URGENT";
  else if (overdueFollowUps) health = "NEEDS_FOLLOW_UP";
  else if (c.status === "ONBOARDING" && now.getTime() - c.createdAt.getTime() < 14 * 86_400_000) health = "NEW_CLIENT";
  else if (waitingTasks) health = "WAITING_FOR_CLIENT";
  else if (seoIssues || (c.healthScore != null && c.healthScore < 60)) health = "SEO_ATTENTION_NEEDED";
  else if (openFollowUps) health = "NEEDS_FOLLOW_UP";
  if (health !== c.supportHealth) await db.client.update({ where: { id: clientId }, data: { supportHealth: health } });
  return health;
}
