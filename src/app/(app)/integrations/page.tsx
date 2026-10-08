import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { modes } from "@/lib/env";
import { messagingLive } from "@/lib/messaging";
import { Badge, Card, DemoBadge, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { disconnectIntegrationAction } from "@/app/actions/clients";
import { pretty } from "@/lib/labels";

export const metadata = { title: "Integrations" };

export default async function IntegrationsPage() {
  const ctx = await requireStaff();
  if (!ctx.can("manage_integrations")) redirect("/dashboard");
  const [ints, conns] = await Promise.all([
    db.integration.findMany({ where: { organizationId: ctx.orgId }, include: { client: { select: { id: true, name: true } } }, orderBy: [{ status: "asc" }, { updatedAt: "desc" }] }),
    db.googleConnection.findMany({ where: { organizationId: ctx.orgId }, include: { _count: { select: { accounts: true } } } }),
  ]);
  const providers = [
    { name: "Anthropic Claude (AI)", live: modes.aiLive(), env: "ANTHROPIC_API_KEY", desc: "Content, recommendations, strategy, reports and assistants" },
    { name: "Google (GBP, Search Console, GA4)", live: modes.googleLive(), env: "GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET", desc: "OAuth for agency and client Google accounts" },
    { name: "AI image generation", live: modes.imagesLive(), env: "IMAGE_PROVIDER / IMAGE_API_KEY", desc: "Brand-safe promotional images" },
    { name: "SERP / rank tracking", live: modes.serpLive(), env: "SERP_PROVIDER / SERP_API_LOGIN", desc: "Keyword rankings, local map grid, competitors" },
    { name: "Email (SMTP)", live: Boolean(process.env.SMTP_URL), env: "SMTP_URL", desc: "Report delivery and critical alerts" },
    { name: "SMS & WhatsApp alerts (Twilio)", live: messagingLive(), env: "TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM", desc: "Critical/high alerts per member channel preferences" },
    { name: "GoHighLevel, call automation, billing", live: false, env: "Phase 5", desc: "Planned integrations — architecture ready" },
  ];
  return (
    <>
      <PageHeader title="Integrations" subtitle="Every integration has connection state, encrypted credentials, sync jobs, retries, last sync, reconnect & disconnect" />
      <Card title="Platform providers" subtitle="Without credentials, the platform runs that integration in clearly labelled Demo Mode with realistic mocked data" pad={false}>
        <ul className="divide-y divide-ink-100">
          {providers.map((p) => (
            <li key={p.name} className="flex items-center gap-3 px-5 py-3">
              <div className="flex-1"><div className="text-sm font-medium">{p.name}</div><div className="text-xs text-ink-500">{p.desc} · <code className="text-[11px]">{p.env}</code></div></div>
              {p.live ? <Badge tone="green" dot>Live</Badge> : <DemoBadge />}
            </li>
          ))}
        </ul>
      </Card>
      <Card title="Google accounts" className="mt-5" actions={<Link href="/settings/google-connections" className="btn-secondary btn-sm">Manage</Link>}>
        <div className="flex flex-wrap gap-2">{conns.map((c) => <span key={c.id} className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-1.5 text-xs">{c.email} <StatusBadge status={c.status} /> {c.mode === "DEMO" && <DemoBadge label="demo" />}</span>)}</div>
      </Card>
      <Card title="Client integrations" className="mt-5" pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["Client", "Integration", "Property / site", "Mode", "Status", "Last sync", "Errors", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {ints.map((i) => (
              <tr key={i.id} className="tr text-sm">
                <td className="td">{i.client ? <Link href={`/clients/${i.client.id}/website?tab=connections`} className="hover:text-brand-700">{i.client.name}</Link> : "Agency"}</td>
                <td className="td">{pretty(i.kind)}</td>
                <td className="td max-w-[220px] truncate text-xs">{i.externalId}</td>
                <td className="td">{i.mode === "DEMO" ? <DemoBadge label="demo" /> : <Badge tone="green">live</Badge>}</td>
                <td className="td"><StatusBadge status={i.status} /></td>
                <td className="td text-xs">{timeAgo(i.lastSyncAt)}</td>
                <td className="td max-w-[200px] truncate text-xs text-red-600">{i.lastError}</td>
                <td className="td">{i.status !== "DISCONNECTED" && <ActionButton action={disconnectIntegrationAction.bind(null, i.id)} confirm="Disconnect and delete stored credentials?" className="btn-ghost btn-sm">Disconnect</ActionButton>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
