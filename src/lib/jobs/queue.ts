import type { ActorType, Prisma } from "@prisma/client";
import { db } from "../db";

export interface EnqueueOptions {
  organizationId: string;
  clientId?: string | null;
  label?: string;
  runAt?: Date;
  dedupeKey?: string;
  maxAttempts?: number;
  priority?: number;
  triggeredBy?: ActorType;
  triggeredById?: string | null;
}

/**
 * Enqueue a background job. Jobs live in AutomationRun, which doubles as the user-visible
 * execution history. A dedupeKey makes enqueueing idempotent (e.g. "daily:gbp.sync:<client>:<date>").
 */
export async function enqueue(type: string, payload: Record<string, unknown>, opts: EnqueueOptions) {
  const data = {
    organizationId: opts.organizationId,
    clientId: opts.clientId ?? null,
    type,
    label: opts.label,
    payload: payload as Prisma.InputJsonValue,
    runAt: opts.runAt ?? new Date(),
    dedupeKey: opts.dedupeKey,
    maxAttempts: opts.maxAttempts ?? 3,
    priority: opts.priority ?? 5,
    triggeredBy: opts.triggeredBy ?? "AUTOMATION",
    triggeredById: opts.triggeredById ?? null,
  };
  if (!opts.dedupeKey) return db.automationRun.create({ data });
  const existing = await db.automationRun.findUnique({ where: { dedupeKey: opts.dedupeKey } });
  if (existing) return existing;
  try {
    return await db.automationRun.create({ data });
  } catch {
    // Unique violation from a concurrent enqueue — fine, the job exists.
    return db.automationRun.findUniqueOrThrow({ where: { dedupeKey: opts.dedupeKey } });
  }
}

/** Atomically claim up to `limit` due jobs (FOR UPDATE SKIP LOCKED — safe with many workers). */
export async function claimJobs(workerId: string, limit = 5) {
  const ids = await db.$queryRaw<{ id: string }[]>`
    UPDATE "AutomationRun" SET "status" = 'RUNNING', "lockedAt" = now(), "lockedBy" = ${workerId},
           "startedAt" = COALESCE("startedAt", now()), "attempts" = "attempts" + 1
    WHERE "id" IN (
      SELECT "id" FROM "AutomationRun"
      WHERE "status" IN ('QUEUED', 'RETRYING') AND "runAt" <= now()
      ORDER BY "priority" ASC, "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING "id"`;
  if (!ids.length) return [];
  return db.automationRun.findMany({ where: { id: { in: ids.map((r) => r.id) } } });
}

/** Jobs stuck RUNNING (worker crashed) are returned to the queue. */
export async function recoverStaleJobs(staleMinutes = 15) {
  return db.$executeRaw`
    UPDATE "AutomationRun" SET "status" = 'RETRYING', "lockedAt" = NULL, "lockedBy" = NULL,
           "lastError" = 'Worker lost while running; re-queued'
    WHERE "status" = 'RUNNING' AND "lockedAt" < now() - (${staleMinutes} || ' minutes')::interval`;
}

export function backoffMs(attempt: number) {
  return Math.min(60 * 60_000, 30_000 * 2 ** (attempt - 1)); // 30s, 60s, 2m ... capped at 1h
}

export async function retryRun(id: string, organizationId: string) {
  return db.automationRun.updateMany({
    where: { id, organizationId, status: { in: ["FAILED", "NEEDS_HUMAN", "CANCELLED"] } },
    data: { status: "QUEUED", runAt: new Date(), attempts: 0, lastError: null, errorDetail: null, completedAt: null },
  });
}

export async function cancelRun(id: string, organizationId: string) {
  return db.automationRun.updateMany({
    where: { id, organizationId, status: { in: ["QUEUED", "RETRYING"] } },
    data: { status: "CANCELLED", completedAt: new Date() },
  });
}
