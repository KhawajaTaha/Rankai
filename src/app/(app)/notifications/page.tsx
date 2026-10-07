import Link from "next/link";
import { Bell } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState, PageHeader, severityTone, timeAgo } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { markNotificationsReadAction } from "@/app/actions/ops";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requireStaff();
  const [items, mentions] = await Promise.all([
    db.notification.findMany({ where: { organizationId: ctx.orgId, recipientId: ctx.memberId }, orderBy: { createdAt: "desc" }, take: 150 }),
    db.mention.findMany({ where: { organizationId: ctx.orgId, mentionedId: ctx.memberId }, orderBy: { createdAt: "desc" }, take: 30 }),
  ]);
  return (
    <>
      <PageHeader title="Notifications" subtitle="In-app now · email for critical items · SMS & WhatsApp channels are planned" actions={<ActionButton action={markNotificationsReadAction} className="btn-secondary">Mark all read</ActionButton>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2" pad={false}>
          <ul className="divide-y divide-ink-100">
            {items.map((n) => (
              <li key={n.id} className={`px-5 py-3 ${n.readAt ? "" : "bg-brand-50/40"}`}>
                <div className="flex items-center gap-2">
                  {!n.readAt && <span className="h-2 w-2 rounded-full bg-brand-500" />}
                  {n.link ? <Link href={n.link} className="text-sm font-medium hover:text-brand-700">{n.title}</Link> : <span className="text-sm font-medium">{n.title}</span>}
                  <Badge tone={severityTone(n.severity)}>{n.severity.toLowerCase()}</Badge>
                  <span className="ml-auto text-xs text-ink-400">{timeAgo(n.createdAt)}</span>
                </div>
                {n.body && <p className="mt-0.5 text-xs text-ink-500">{n.body}</p>}
              </li>
            ))}
          </ul>
          {!items.length && <EmptyState icon={<Bell className="h-5 w-5" />} title="You're all caught up" />}
        </Card>
        <Card title="@Mentions" pad={false}>
          <ul className="divide-y divide-ink-100">{mentions.map((m) => <li key={m.id} className="px-5 py-3 text-xs"><div className="text-ink-700">{m.excerpt}</div><div className="text-ink-400">{m.entityType} · {timeAgo(m.createdAt)}</div></li>)}</ul>
          {!mentions.length && <EmptyState title="No mentions" />}
        </Card>
      </div>
    </>
  );
}
