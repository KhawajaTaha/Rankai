"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { assertClientAccess } from "@/lib/tenancy";
import { activity, audit } from "@/lib/audit";
import { createTicket, processMentions, updateSupportHealth } from "@/lib/services/support";
import { notify } from "@/lib/notify";

export async function createTicketAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_tickets"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const t = await createTicket({ organizationId: ctx.orgId, clientId, type: (fd.str(f, "type") || "OTHER") as "OTHER", subject: z.string().min(3).max(200).parse(fd.str(f, "subject")), description: z.string().min(3).parse(fd.str(f, "description")), priority: (fd.str(f, "priority") || "NORMAL") as "NORMAL", requestedBy: fd.opt(f, "requestedBy") ?? undefined, actor: actorOf(ctx) });
    revalidatePath("/support/tickets");
    return { ok: true, message: `Request #${t.number} created`, redirect: `/support/tickets/${t.id}` };
  });
}

export async function replyTicketAction(ticketId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_tickets"], async (ctx) => {
    const t = await db.supportTicket.findFirstOrThrow({ where: { id: ticketId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, t.clientId);
    const body = z.string().min(1).max(10000).parse(fd.str(f, "body"));
    const internal = fd.bool(f, "internal");
    await db.ticketMessage.create({ data: { organizationId: ctx.orgId, ticketId, authorId: ctx.memberId, authorName: `${ctx.user.name}${internal ? " (internal)" : ""}`, body } });
    const status = (fd.str(f, "status") || (t.status === "OPEN" ? "IN_PROGRESS" : t.status)) as "OPEN";
    await db.supportTicket.update({ where: { id: t.id }, data: { status, firstResponseAt: t.firstResponseAt ?? (internal ? null : new Date()), resolvedAt: ["RESOLVED", "CLOSED"].includes(status) ? new Date() : null } });
    await processMentions(actorOf(ctx), body, { clientId: t.clientId, entityType: "SupportTicket", entityId: t.id, link: `/support/tickets/${t.id}` });
    if (!internal) {
      const portal = await db.organizationUser.findMany({ where: { organizationId: ctx.orgId, clientId: t.clientId } });
      await notify({ organizationId: ctx.orgId, recipientIds: portal.map((p) => p.id), clientId: t.clientId, type: "ticket.reply", title: `Update on request #${t.number}`, body: body.slice(0, 200), link: `/portal/support`, severity: "MEDIUM" });
    }
    await activity({ organizationId: ctx.orgId, clientId: t.clientId, category: "SUPPORT", type: "ticket.reply", title: `Replied to request #${t.number}`, actor: actorOf(ctx) });
    await updateSupportHealth(t.clientId);
    revalidatePath(`/support/tickets/${t.id}`);
    return { ok: true, message: "Sent" };
  });
}

export async function updateTicketAction(ticketId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_tickets"], async (ctx) => {
    const t = await db.supportTicket.findFirstOrThrow({ where: { id: ticketId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, t.clientId);
    const assignee = fd.opt(f, "assignedToId");
    if (assignee && !(await db.organizationUser.findFirst({ where: { id: assignee, organizationId: ctx.orgId } }))) throw new Error("Invalid assignee");
    const status = (fd.str(f, "status") || t.status) as "OPEN";
    await db.supportTicket.update({ where: { id: t.id }, data: { status, priority: (fd.str(f, "priority") || t.priority) as "NORMAL", assignedToId: assignee, resolvedAt: ["RESOLVED", "CLOSED"].includes(status) ? t.resolvedAt ?? new Date() : null } });
    await audit({ organizationId: ctx.orgId, clientId: t.clientId, actor: actorOf(ctx), action: "ticket.update", entityType: "SupportTicket", entityId: t.id, oldValue: { status: t.status, priority: t.priority, assignedToId: t.assignedToId }, newValue: { status, assignee }, source: "ui" });
    await updateSupportHealth(t.clientId);
    revalidatePath(`/support/tickets/${t.id}`);
    return { ok: true, message: "Updated" };
  });
}

export async function saveSlaAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_support"], async (ctx) => {
    for (const p of ["URGENT", "HIGH", "NORMAL", "LOW"] as const) {
      const hours = Math.max(1, Math.min(720, fd.int(f, `respond_${p}`, 24)));
      await db.slaPolicy.upsert({ where: { organizationId_priority: { organizationId: ctx.orgId, priority: p } }, create: { organizationId: ctx.orgId, priority: p, respondWithinHours: hours }, update: { respondWithinHours: hours } });
    }
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "sla.update", newValue: Object.fromEntries(f.entries()), source: "ui" });
    revalidatePath("/settings");
    return { ok: true, message: "SLA saved" };
  });
}
