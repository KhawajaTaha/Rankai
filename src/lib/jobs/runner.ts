import os from "node:os";
import type { AutomationRun, Prisma } from "@prisma/client";
import { db } from "../db";
import { raiseAlert, clientTeam, membersWithRole, notify } from "../notify";
import { createTask } from "../tasks";
import { ExecutionError } from "../engine/executor";
import { INTEGRATION_HELP, NotConfiguredError } from "../errors";
import { GoogleAuthError } from "../integrations/google-oauth";
import { backoffMs, claimJobs, enqueue, recoverStaleJobs } from "./queue";
import { HANDLERS } from "./handlers";

const WORKER_ID = `${os.hostname()}:${process.pid}`;

/** Execute one claimed job with retry/backoff and failed-automation recovery (spec §71-72). */
export async function runJob(run: AutomationRun) {
  const entry = HANDLERS[run.type];
  if (!entry) {
    await db.automationRun.update({ where: { id: run.id }, data: { status: "FAILED", lastError: `No handler for ${run.type}`, completedAt: new Date(), lockedAt: null } });
    return;
  }
  if (run.clientId && !(await db.client.findUnique({ where: { id: run.clientId }, select: { id: true } }))) {
    await db.automationRun.update({ where: { id: run.id }, data: { status: "CANCELLED", completedAt: new Date(), lastError: "Client no longer exists", lockedAt: null, lockedBy: null } });
    return;
  }
  try {
    const result = await entry.handler((run.payload ?? {}) as Record<string, unknown>, run);
    await db.automationRun.update({
      where: { id: run.id },
      data: { status: "SUCCEEDED", completedAt: new Date(), lockedAt: null, lockedBy: null, lastError: null, result: (result === undefined ? undefined : JSON.parse(JSON.stringify(result))) as Prisma.InputJsonValue | undefined },
    });
  } catch (e) {
    const err = e as Error;
    if (err instanceof NotConfiguredError) {
      // Live mode, missing credentials: no retries, no per-client task spam — one org-level alert.
      await db.automationRun.update({ where: { id: run.id }, data: { status: "CANCELLED", completedAt: new Date(), lastError: err.message, lockedAt: null, lockedBy: null } });
      const help = INTEGRATION_HELP[err.integration];
      await raiseAlert({ organizationId: run.organizationId, severity: "HIGH", type: "integration_not_configured", title: `${help.label} is not configured`, detail: `Automations that need it are paused. Add ${help.env} to the server environment (see Settings → Go-Live).`, dedupeKey: `not_configured:${err.integration}`, link: "/settings/go-live" });
      return;
    }
    const nonRetryable = (err instanceof ExecutionError && !err.retryable) || err instanceof GoogleAuthError;
    const exhausted = run.attempts >= run.maxAttempts || nonRetryable;
    if (!exhausted) {
      await db.automationRun.update({ where: { id: run.id }, data: { status: "RETRYING", runAt: new Date(Date.now() + backoffMs(run.attempts)), lastError: err.message.slice(0, 500), errorDetail: err.stack?.slice(0, 4000), lockedAt: null, lockedBy: null } });
      return;
    }
    // Never fail silently: mark for human, create a task, notify the right people.
    await db.automationRun.update({ where: { id: run.id }, data: { status: "NEEDS_HUMAN", completedAt: new Date(), lastError: err.message.slice(0, 500), errorDetail: err.stack?.slice(0, 4000), lockedAt: null, lockedBy: null } });
    const label = run.label ?? entry.label;
    if (run.clientId) {
      await createTask({
        organizationId: run.organizationId,
        clientId: run.clientId,
        title: `Automation failed: ${label}`,
        description: `${err.message}\n\nAttempts: ${run.attempts}. Retry from Automations → Execution History once the cause is fixed.`,
        category: err instanceof GoogleAuthError ? "Integration" : "Technical",
        priority: "HIGH",
        source: "AUTOMATION",
        sourceRef: run.id,
        dedupeKey: `runfail:${run.type}:${run.clientId}`,
      });
      const team = await clientTeam(run.clientId);
      await notify({ organizationId: run.organizationId, recipientIds: team.all, type: "automation.failed", title: `Automation failed: ${label}`, body: err.message.slice(0, 200), link: `/automations/history?run=${run.id}`, clientId: run.clientId, severity: "HIGH" });
    } else {
      await notify({ organizationId: run.organizationId, recipientIds: await membersWithRole(run.organizationId, ["agency_admin"]), type: "automation.failed", title: `Automation failed: ${label}`, body: err.message.slice(0, 200), link: "/automations/history", severity: "HIGH" });
    }
    if (["content.publish", "recommendation.execute", "reviews.post_reply"].includes(run.type)) {
      await raiseAlert({ organizationId: run.organizationId, clientId: run.clientId, severity: "CRITICAL", type: "automation_failure", title: `${label} failed after ${run.attempts} attempts`, detail: err.message.slice(0, 300), dedupeKey: `runfail:${run.id}` });
    }
  }
}

let running = false;
let lastSchedulerAt = 0;

/** One worker iteration: recover stale jobs, tick the scheduler every 5 min, claim + run jobs. */
export async function workOnce(batch = 5) {
  if (running) return 0;
  running = true;
  try {
    if (Date.now() - lastSchedulerAt > 5 * 60_000) {
      lastSchedulerAt = Date.now();
      await recoverStaleJobs();
      const org = await db.organization.findFirst({ select: { id: true } });
      if (org) {
        const slot = Math.floor(Date.now() / (5 * 60_000));
        await enqueue("scheduler.tick", {}, { organizationId: org.id, label: "Scheduler tick", dedupeKey: `tick:${slot}`, priority: 1, maxAttempts: 1 });
      }
    }
    const jobs = await claimJobs(WORKER_ID, batch);
    for (const j of jobs) await runJob(j);
    return jobs.length;
  } finally {
    running = false;
  }
}

export function startWorkerLoop(intervalMs = 4000) {
  const g = globalThis as unknown as { __lsaWorker?: NodeJS.Timeout };
  if (g.__lsaWorker) return;
  console.info(`[worker] started ${WORKER_ID}`);
  const tick = async () => {
    try {
      let n = await workOnce();
      while (n > 0) n = await workOnce();
    } catch (e) {
      console.error("[worker] iteration failed", e);
    }
  };
  g.__lsaWorker = setInterval(tick, intervalMs);
  void tick();
}
