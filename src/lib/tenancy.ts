import "server-only";
import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { db } from "./db";
import { ForbiddenError, type Ctx } from "./auth";

/**
 * Strict tenant isolation. Every client-scoped read must use clientWhere()/assertClientAccess().
 *  - organizationId is always enforced
 *  - staff without view_all_clients only see clients they are assigned to
 *  - client-portal users only ever see their own client
 */
export function clientWhere(ctx: Ctx, extra: Prisma.ClientWhereInput = {}): Prisma.ClientWhereInput {
  const base: Prisma.ClientWhereInput = { organizationId: ctx.orgId, archivedAt: null, ...extra };
  if (ctx.isClientUser) return { ...base, id: ctx.portalClientId ?? "__none__" };
  if (!ctx.can("view_all_clients")) return { ...base, assignments: { some: { memberId: ctx.memberId } } };
  return base;
}

/** Predicate for any client-scoped table (tasks, calls, notes...): limits to accessible clients. */
export function scopedByClient(ctx: Ctx): { organizationId: string; clientId?: { in: string[] } | string } {
  if (ctx.isClientUser) return { organizationId: ctx.orgId, clientId: ctx.portalClientId ?? "__none__" };
  return { organizationId: ctx.orgId };
}

export async function accessibleClientIds(ctx: Ctx): Promise<string[] | null> {
  if (ctx.isClientUser) return [ctx.portalClientId ?? "__none__"];
  if (ctx.can("view_all_clients")) return null; // all in org
  const rows = await db.clientAssignment.findMany({ where: { organizationId: ctx.orgId, memberId: ctx.memberId }, select: { clientId: true } });
  return rows.map((r) => r.clientId);
}

/** Prisma filter for client-scoped models respecting assignment restrictions. */
export async function clientScopeFilter(ctx: Ctx): Promise<{ organizationId: string; clientId?: { in: string[] } }> {
  const ids = await accessibleClientIds(ctx);
  return ids ? { organizationId: ctx.orgId, clientId: { in: ids } } : { organizationId: ctx.orgId };
}

export async function getAccessibleClient(ctx: Ctx, clientId: string) {
  const client = await db.client.findFirst({ where: clientWhere(ctx, { id: clientId }) });
  if (!client) notFound();
  return client;
}

/** For server actions: throws (instead of 404 page) when the client is not accessible. */
export async function assertClientAccess(ctx: Ctx, clientId: string) {
  const client = await db.client.findFirst({ where: clientWhere(ctx, { id: clientId }), select: { id: true, organizationId: true, name: true } });
  if (!client) throw new ForbiddenError("Client not found or not accessible");
  return client;
}
