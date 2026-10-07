import type { Severity } from "@prisma/client";
import { db } from "./db";
import { sendEmail } from "./email";

/**
 * Smart notifications:
 *  - CRITICAL / HIGH are delivered immediately (in-app + email for CRITICAL)
 *  - MEDIUM / LOW are grouped by digestKey so staff are not flooded (one unread item per group/day)
 */
export async function notify(args: {
  organizationId: string;
  recipientIds: string[];
  type: string;
  title: string;
  body?: string;
  link?: string;
  clientId?: string | null;
  severity?: Severity;
}) {
  const severity = args.severity ?? "LOW";
  const recipients = [...new Set(args.recipientIds.filter(Boolean))];
  const day = new Date().toISOString().slice(0, 10);
  for (const recipientId of recipients) {
    if (severity === "LOW" || severity === "MEDIUM") {
      const digestKey = `${args.type}:${args.clientId ?? "org"}:${day}`;
      const existing = await db.notification.findFirst({ where: { organizationId: args.organizationId, recipientId, digestKey, readAt: null } });
      if (existing) {
        const count = (Number(/\((\d+)\)$/.exec(existing.title)?.[1] ?? 1) || 1) + 1;
        await db.notification.update({
          where: { id: existing.id },
          data: { title: `${args.title.replace(/ \(\d+\)$/, "")} (${count})`, body: args.body ?? existing.body, createdAt: new Date() },
        });
        continue;
      }
      await db.notification.create({ data: { ...base(args, recipientId, severity), digestKey } });
    } else {
      await db.notification.create({ data: base(args, recipientId, severity) });
      if (severity === "CRITICAL") {
        const m = await db.organizationUser.findUnique({ where: { id: recipientId }, include: { user: true } });
        if (m?.user.email) await sendEmail({ to: m.user.email, subject: `[Urgent] ${args.title}`, text: `${args.body ?? ""}\n\n${args.link ?? ""}` });
      }
    }
  }
}

function base(args: Parameters<typeof notify>[0], recipientId: string, severity: Severity) {
  return {
    organizationId: args.organizationId,
    recipientId,
    clientId: args.clientId ?? null,
    type: args.type,
    title: args.title,
    body: args.body,
    link: args.link,
    severity,
  };
}

/** Members assigned to a client by assignment type (falls back to managers/admins). */
export async function clientTeam(clientId: string) {
  const rows = await db.clientAssignment.findMany({ where: { clientId }, select: { memberId: true, type: true } });
  return {
    support: rows.filter((r) => r.type === "SUPPORT").map((r) => r.memberId),
    seo: rows.filter((r) => r.type === "SEO").map((r) => r.memberId),
    content: rows.filter((r) => r.type === "CONTENT").map((r) => r.memberId),
    all: [...new Set(rows.map((r) => r.memberId))],
  };
}

export async function membersWithRole(organizationId: string, roleKeys: string[]) {
  const rows = await db.organizationUser.findMany({
    where: { organizationId, status: "ACTIVE", role: { key: { in: roleKeys } } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}

/**
 * Raise an alert (deduplicated) and notify the right people based on severity.
 * Low/medium alerts are grouped; critical alerts escalate to admins.
 */
export async function raiseAlert(args: {
  organizationId: string;
  clientId?: string | null;
  severity: Severity;
  type: string;
  title: string;
  detail?: string;
  dedupeKey?: string;
  entityType?: string;
  entityId?: string;
  link?: string;
}) {
  if (args.dedupeKey) {
    const existing = await db.alert.findUnique({ where: { organizationId_dedupeKey: { organizationId: args.organizationId, dedupeKey: args.dedupeKey } } });
    if (existing && existing.status !== "RESOLVED") return existing;
    if (existing) {
      return db.alert.update({ where: { id: existing.id }, data: { status: "OPEN", resolvedAt: null, createdAt: new Date(), title: args.title, detail: args.detail } });
    }
  }
  const alert = await db.alert.create({
    data: {
      organizationId: args.organizationId,
      clientId: args.clientId ?? null,
      severity: args.severity,
      type: args.type,
      title: args.title,
      detail: args.detail,
      dedupeKey: args.dedupeKey,
      groupKey: args.severity === "LOW" || args.severity === "MEDIUM" ? args.type : null,
      entityType: args.entityType,
      entityId: args.entityId,
    },
  });
  const team = args.clientId ? await clientTeam(args.clientId) : { all: [] as string[] };
  let recipients = team.all;
  if (args.severity === "CRITICAL" || recipients.length === 0) {
    recipients = [...recipients, ...(await membersWithRole(args.organizationId, ["agency_admin", "super_admin"]))];
  }
  await notify({
    organizationId: args.organizationId,
    recipientIds: recipients,
    type: `alert.${args.type}`,
    title: args.title,
    body: args.detail,
    link: args.link ?? (args.clientId ? `/clients/${args.clientId}` : "/alerts"),
    clientId: args.clientId,
    severity: args.severity,
  });
  return alert;
}

export async function resolveAlerts(organizationId: string, dedupeKey: string) {
  await db.alert.updateMany({ where: { organizationId, dedupeKey, status: { not: "RESOLVED" } }, data: { status: "RESOLVED", resolvedAt: new Date() } });
}
