import { requireCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, timeAgo } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { TwoFactorSetup } from "@/components/two-factor";
import { disableTotpAction, revokeOtherSessionsAction } from "@/app/actions/auth";
import { NotificationPrefs } from "@/components/notification-prefs";

export const metadata = { title: "Security" };

export default async function SecurityPage() {
  const ctx = await requireCtx();
  const sessions = await db.session.findMany({ where: { userId: ctx.user.id }, orderBy: { lastSeenAt: "desc" }, take: 10 });
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <PageHeader title="Security" subtitle="Two-factor authentication, notification channels and active sessions" />
      <Card title="Two-factor authentication (TOTP)">
        {ctx.user.totpEnabled ? (
          <div className="flex items-center justify-between"><span className="text-sm text-emerald-700">2FA is enabled for your account.</span><ActionButton action={disableTotpAction} confirm="Disable two-factor authentication?">Disable 2FA</ActionButton></div>
        ) : <TwoFactorSetup email={ctx.user.email} />}
      </Card>
      <Card title="Notification channels" subtitle="How urgent alerts reach you outside the app">
        <NotificationPrefs prefs={ctx.member.notificationPrefs} phone={ctx.user.phone} smtpLive={Boolean(process.env.SMTP_URL)} />
      </Card>
      <Card title="Active sessions" pad={false} actions={sessions.length > 1 && <ActionButton action={revokeOtherSessionsAction} confirm="Sign out every other device?">Sign out other sessions</ActionButton>}>
        <ul className="divide-y divide-ink-100">{sessions.map((s) => <li key={s.id} className="px-5 py-2.5 text-xs"><div className="font-medium text-ink-800">{s.userAgent?.slice(0, 80) ?? "Unknown device"}{s.id === ctx.sessionId ? " (this session)" : ""}</div><div className="text-ink-500">{s.ip ?? "—"} · last seen {timeAgo(s.lastSeenAt)} · expires {timeAgo(s.expiresAt)}</div></li>)}</ul>
      </Card>
    </div>
  );
}
