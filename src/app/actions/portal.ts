"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { decideApproval } from "@/lib/engine/recommendations";
import { createTicket } from "@/lib/services/support";
import { notify } from "@/lib/notify";
import { activity } from "@/lib/audit";

export async function portalDecideAction(approvalId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["portal_approve"], async (ctx) => {
    if (!ctx.portalClientId) throw new Error("Not a client portal user");
    const a = await db.approval.findFirstOrThrow({ where: { id: approvalId, organizationId: ctx.orgId, clientId: ctx.portalClientId, requiresClient: true, status: "PENDING" } });
    const decision = fd.str(f, "decision") as "APPROVED";
    if (!["APPROVED", "REJECTED", "CHANGES_REQUESTED"].includes(decision)) throw new Error("Invalid decision");
    await decideApproval({ approvalId: a.id, organizationId: ctx.orgId, decision, actor: actorOf(ctx), note: fd.opt(f, "note") });
    const team = await db.clientAssignment.findMany({ where: { clientId: a.clientId }, select: { memberId: true } });
    await notify({ organizationId: ctx.orgId, recipientIds: team.map((t) => t.memberId), clientId: a.clientId, type: "client.approval", title: `Client ${decision === "APPROVED" ? "approved" : decision === "REJECTED" ? "rejected" : "requested changes to"}: ${a.title}`, body: fd.str(f, "note"), link: `/clients/${a.clientId}`, severity: decision === "APPROVED" ? "LOW" : "MEDIUM" });
    revalidatePath("/portal/approvals");
    return { ok: true, message: decision === "APPROVED" ? "Thanks — approved." : "Thanks — your team has been notified." };
  });
}

export async function portalRequestHelpAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["portal_request_help"], async (ctx) => {
    if (!ctx.portalClientId) throw new Error("Not a client portal user");
    const t = await createTicket({
      organizationId: ctx.orgId, clientId: ctx.portalClientId, type: (["WEBSITE_CHANGE", "GBP_CHANGE", "NEW_SERVICE", "CONTENT_REQUEST", "BILLING", "TECHNICAL_PROBLEM", "OTHER"].includes(fd.str(f, "type")) ? fd.str(f, "type") : "OTHER") as "OTHER",
      subject: z.string().min(3).max(200).parse(fd.str(f, "subject")), description: z.string().min(3).max(5000).parse(fd.str(f, "description")), priority: fd.str(f, "urgent") === "on" ? "HIGH" : undefined, requestedBy: ctx.user.name, actor: actorOf(ctx),
    });
    revalidatePath("/portal/support");
    return { ok: true, message: `Request #${t.number} received. Your support agent has been notified.` };
  });
}

export async function portalReplyAction(ticketId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["portal_request_help"], async (ctx) => {
    const t = await db.supportTicket.findFirstOrThrow({ where: { id: ticketId, organizationId: ctx.orgId, clientId: ctx.portalClientId ?? "__" } });
    const body = z.string().min(1).max(5000).parse(fd.str(f, "body"));
    await db.ticketMessage.create({ data: { organizationId: ctx.orgId, ticketId: t.id, authorName: ctx.user.name, fromClient: true, body } });
    await db.supportTicket.update({ where: { id: t.id }, data: { status: t.status === "WAITING_FOR_CLIENT" || t.status === "RESOLVED" ? "OPEN" : t.status } });
    if (t.assignedToId) await notify({ organizationId: ctx.orgId, recipientIds: [t.assignedToId], clientId: t.clientId, type: "ticket.client_reply", title: `Client replied on #${t.number}`, body: body.slice(0, 200), link: `/support/tickets/${t.id}`, severity: "MEDIUM" });
    await activity({ organizationId: ctx.orgId, clientId: t.clientId, category: "CLIENT", type: "ticket.client_reply", title: `Client replied on request #${t.number}`, actor: actorOf(ctx) });
    revalidatePath("/portal/support");
    return { ok: true, message: "Sent" };
  });
}
