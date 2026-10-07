import { db } from "../db";
import { activity, audit, type Actor } from "../audit";
import { enqueue } from "../jobs/queue";

/**
 * Safe offboarding (spec §81): pause automation, generate a final report, remove scheduled
 * content, release integrations — never deletes the client's GBP or website data on Google/WordPress.
 */
export async function offboardClient(organizationId: string, clientId: string, actor: Actor, opts: { revokeIntegrations: boolean }) {
  const client = await db.client.findFirstOrThrow({ where: { id: clientId, organizationId } });
  await db.client.update({ where: { id: clientId }, data: { status: "OFFBOARDING", automationPaused: true } });
  const removed = await db.contentItem.updateMany({ where: { clientId, status: { in: ["IDEA", "DRAFT", "NEEDS_APPROVAL", "APPROVED", "SCHEDULED"] } }, data: { status: "PAUSED" } });
  await db.automationRun.updateMany({ where: { clientId, status: { in: ["QUEUED", "RETRYING"] } }, data: { status: "CANCELLED", completedAt: new Date() } });
  await db.approval.updateMany({ where: { clientId, status: "PENDING" }, data: { status: "EXPIRED" } });
  if (opts.revokeIntegrations) {
    // Release the GBP assignment and stored website credentials. The Google profile itself is untouched.
    await db.gbpLocation.updateMany({ where: { clientId }, data: { clientId: null, assignedAt: null } });
    await db.integration.updateMany({ where: { clientId }, data: { status: "DISCONNECTED", credentialsEnc: null } });
  }
  await enqueue("report.generate", { clientId, type: "FINAL" }, { organizationId, clientId, label: "Final report", priority: 1 });
  await enqueue("client.archive", { clientId }, { organizationId, clientId, label: "Archive client after final report", runAt: new Date(Date.now() + 10 * 60_000) });
  await audit({ organizationId, clientId, actor, action: "client.offboard", entityType: "Client", entityId: clientId, newValue: { revokeIntegrations: opts.revokeIntegrations, scheduledContentPaused: removed.count }, source: "ui" });
  await activity({ organizationId, clientId, category: "CLIENT", type: "client.offboarding", title: `Offboarding started for ${client.name}`, detail: `${removed.count} scheduled item(s) paused`, actor });
}

export async function archiveClient(clientId: string) {
  await db.client.update({ where: { id: clientId }, data: { status: "ARCHIVED", archivedAt: new Date() } });
}
