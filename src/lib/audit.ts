import type { ActorType, Prisma } from "@prisma/client";
import { db } from "./db";

type Tx = Prisma.TransactionClient | typeof db;

export interface Actor {
  type: ActorType;
  id?: string | null; // OrganizationUser id or User id for humans
  name?: string | null;
  userId?: string | null;
}

export const SYSTEM_ACTOR: Actor = { type: "SYSTEM", name: "System" };
export const AI_ACTOR: Actor = { type: "AI", name: "Autopilot AI" };
export const AUTOMATION_ACTOR: Actor = { type: "AUTOMATION", name: "Automation" };

/** Immutable audit trail entry (who/what/when/old/new/source). */
export async function audit(
  args: {
    organizationId: string | null;
    clientId?: string | null;
    actor: Actor;
    action: string;
    entityType?: string;
    entityId?: string;
    oldValue?: unknown;
    newValue?: unknown;
    source?: string;
    approvalId?: string;
    automationRunId?: string;
    ip?: string | null;
  },
  tx: Tx = db,
) {
  await tx.auditLog.create({
    data: {
      organizationId: args.organizationId,
      clientId: args.clientId ?? null,
      userId: args.actor.userId ?? null,
      actorType: args.actor.type,
      action: args.action,
      entityType: args.entityType,
      entityId: args.entityId,
      oldValue: args.oldValue === undefined ? undefined : (JSON.parse(JSON.stringify(args.oldValue)) as Prisma.InputJsonValue),
      newValue: args.newValue === undefined ? undefined : (JSON.parse(JSON.stringify(args.newValue)) as Prisma.InputJsonValue),
      source: args.source,
      approvalId: args.approvalId,
      automationRunId: args.automationRunId,
      ip: args.ip ?? null,
    },
  });
}

export type ActivityCategory = "GBP" | "WEBSITE" | "SEO" | "CONTENT" | "SUPPORT" | "AI" | "CLIENT" | "SYSTEM";

/** Human-readable client timeline entry. */
export async function activity(
  args: {
    organizationId: string;
    clientId?: string | null;
    category: ActivityCategory;
    type: string;
    title: string;
    detail?: string | null;
    actor: Actor;
    entityType?: string;
    entityId?: string;
  },
  tx: Tx = db,
) {
  await tx.activityLog.create({
    data: {
      organizationId: args.organizationId,
      clientId: args.clientId ?? null,
      category: args.category,
      type: args.type,
      title: args.title,
      detail: args.detail ?? null,
      actorType: args.actor.type,
      actorId: args.actor.id ?? null,
      actorName: args.actor.name ?? null,
      entityType: args.entityType,
      entityId: args.entityId,
    },
  });
}
