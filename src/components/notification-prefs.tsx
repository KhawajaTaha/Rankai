import { ActionForm, Field, SubmitButton } from "./client";
import { channelsFor, messagingLive } from "@/lib/messaging";
import { updateNotificationPrefsAction } from "@/app/actions/team";
import { DemoBadge } from "./ui";

export function NotificationPrefs({ prefs, phone, smtpLive }: { prefs: unknown; phone: string | null; smtpLive: boolean }) {
  const rows = [
    { sev: "CRITICAL" as const, label: "Critical", hint: "Website offline, GBP disconnected, 1-star review, automation failure" },
    { sev: "HIGH" as const, label: "High", hint: "Overdue follow-ups, failed publishing, assigned urgent tasks" },
  ];
  return (
    <ActionForm action={updateNotificationPrefsAction} resetOnSuccess={false} className="space-y-4">
      <p className="text-xs text-ink-500">In-app notifications are always on. Medium and low-priority items are grouped in-app so you aren&apos;t overwhelmed.</p>
      <Field label="Mobile number (for SMS / WhatsApp)"><input name="phone" defaultValue={phone ?? ""} className="input max-w-xs" placeholder="+1 807 555 0100" /></Field>
      <table className="w-full text-sm">
        <thead><tr><th className="th">Severity</th><th className="th">Email {!smtpLive && <DemoBadge label="demo" />}</th><th className="th">SMS {!messagingLive() && <DemoBadge label="demo" />}</th><th className="th">WhatsApp</th></tr></thead>
        <tbody>
          {rows.map((r) => {
            const on = channelsFor(prefs, r.sev);
            return (
              <tr key={r.sev} className="border-t border-ink-100">
                <td className="td"><div className="font-medium">{r.label}</div><div className="text-[11px] text-ink-400">{r.hint}</div></td>
                {(["EMAIL", "SMS", "WHATSAPP"] as const).map((c) => <td key={c} className="td"><input type="checkbox" name={r.sev} value={c} defaultChecked={on.includes(c)} className="h-4 w-4 rounded" /></td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
      <SubmitButton>Save preferences</SubmitButton>
    </ActionForm>
  );
}
