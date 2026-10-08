import { db } from "../db";
import { audit, SYSTEM_ACTOR } from "../audit";
import { addDays } from "../utils";

/**
 * Data retention & housekeeping (spec §81): archived clients are purged from the platform once
 * the agency's retention window has passed. Only platform-side records are removed — nothing on
 * Google or the client's website is touched. The immutable audit log is kept (no FK to clients).
 */
export async function runRetention(organizationId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const cutoff = addDays(new Date(), -org.retentionDays);
  const expired = await db.client.findMany({ where: { organizationId, status: "ARCHIVED", archivedAt: { lt: cutoff } }, select: { id: true, name: true, archivedAt: true } });
  for (const c of expired) {
    await db.$transaction([
      db.gbpLocation.updateMany({ where: { clientId: c.id }, data: { clientId: null } }), // keep agency-account locations, just unassign
      db.automationRun.deleteMany({ where: { clientId: c.id } }),
      db.alert.deleteMany({ where: { clientId: c.id } }),
      db.notification.deleteMany({ where: { clientId: c.id } }),
      db.client.delete({ where: { id: c.id } }), // cascades client-owned rows
    ]);
    await audit({ organizationId, clientId: c.id, actor: SYSTEM_ACTOR, action: "client.purged", entityType: "Client", entityId: c.id, oldValue: { name: c.name, archivedAt: c.archivedAt }, newValue: { retentionDays: org.retentionDays }, source: "worker" });
  }
  const now = new Date();
  const [sessions, states, buckets, notifications] = await Promise.all([
    db.session.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.oAuthState.deleteMany({ where: { expiresAt: { lt: now } } }),
    db.rateLimitBucket.deleteMany({ where: { resetAt: { lt: now } } }),
    db.notification.deleteMany({ where: { organizationId, readAt: { lt: addDays(now, -90) } } }),
  ]);
  return { purgedClients: expired.length, sessions: sessions.count, oauthStates: states.count, rateBuckets: buckets.count, notifications: notifications.count };
}
