import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientWhere } from "@/lib/tenancy";
import { modes } from "@/lib/env";
import { Badge, Card, DemoBadge, EmptyState, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { ActionButton, ActionForm, SubmitButton } from "@/components/client";
import { assignLocationFromCenterAction, connectGoogleAction, disconnectGoogleAction, syncConnectionAction, unassignLocationAction } from "@/app/actions/google";

export const metadata = { title: "Google Connections" };

export default async function GoogleConnectionsPage({ searchParams }: { searchParams: Promise<{ q?: string; error?: string; connected?: string; conn?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const can = ctx.can("connect_gbp");
  const [conns, clients] = await Promise.all([
    db.googleConnection.findMany({ where: { organizationId: ctx.orgId }, include: { accounts: { include: { locations: { include: { client: { select: { id: true, name: true } } }, orderBy: { title: "asc" } } } } }, orderBy: { createdAt: "asc" } }),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const q = (sp.q ?? "").toLowerCase();
  return (
    <>
      <PageHeader title="Google Connections" subtitle="One agency Google account can manage many client profiles. Search, select and assign — duplicates are prevented." actions={can && <form action={connectGoogleAction.bind(null, "AGENCY_GBP", undefined)}><button className="btn-primary">+ Connect agency Google account</button></form>} />
      {!modes.googleLive() && <div className="mb-4 rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-800">Google OAuth credentials are not configured — new connections are created in <b>Demo Mode</b> with realistic mocked locations. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET for live OAuth.</div>}
      {sp.error && <div className="mb-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">Google connection failed: {sp.error}</div>}
      {sp.connected && <div className="mb-4 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-800">Google account connected and locations retrieved.</div>}
      <div className="space-y-5">
        {conns.map((c) => {
          const locations = c.accounts.flatMap((a) => a.locations);
          const shown = locations.filter((l) => !q || l.title.toLowerCase().includes(q) || (l.address ?? "").toLowerCase().includes(q));
          return (
            <Card key={c.id} title={<span className="flex items-center gap-2">{c.email} <StatusBadge status={c.status} /> {c.mode === "DEMO" && <DemoBadge />} <Badge>{c.ownerType.toLowerCase()}</Badge></span>} subtitle={`${locations.length} GBP locations · ${locations.filter((l) => l.clientId).length} assigned · last sync ${timeAgo(c.lastSyncAt)} · token ${c.mode === "DEMO" ? "n/a (demo)" : c.tokenExpiresAt ? `refreshes ${timeAgo(c.tokenExpiresAt)}` : "missing"}${c.lastError ? ` · ${c.lastError}` : ""}`} pad={false}
              actions={can && <>
                <ActionButton action={syncConnectionAction.bind(null, c.id)}>Sync</ActionButton>
                {c.status !== "CONNECTED" && <form action={connectGoogleAction.bind(null, "AGENCY_GBP", undefined)}><button className="btn-primary btn-sm">Reconnect</button></form>}
                {c.status !== "DISCONNECTED" && <ActionButton action={disconnectGoogleAction.bind(null, c.id)} className="btn-ghost btn-sm" confirm="Disconnect? Client assignments for these profiles will be released. Profiles on Google are untouched.">Disconnect</ActionButton>}
              </>}>
              <form className="border-b border-ink-100 px-5 py-2.5"><input name="q" defaultValue={sp.q} placeholder="Search locations…" className="input h-8 max-w-xs" /></form>
              <div className="max-h-[480px] overflow-y-auto">
                <table className="w-full">
                  <thead className="sticky top-0 bg-ink-50"><tr>{["Location", "Address", "Category", "Assigned client", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
                  <tbody>
                    {shown.map((l) => (
                      <tr key={l.id} className="tr text-sm">
                        <td className="td font-medium">{l.title}</td>
                        <td className="td text-xs text-ink-500">{l.address}</td>
                        <td className="td text-xs">{l.primaryCategory}</td>
                        <td className="td">{l.client ? <Badge tone="green">{l.client.name}</Badge> : <span className="text-xs text-ink-400">Unassigned</span>}</td>
                        <td className="td">
                          {can && (l.client ? <ActionButton action={unassignLocationAction.bind(null, l.id)} className="btn-ghost btn-sm" confirm="Unassign this profile from the client?">Unassign</ActionButton> : (
                            <ActionForm action={assignLocationFromCenterAction} className="flex gap-1.5" hideMessage={false}>
                              <input type="hidden" name="locationId" value={l.id} />
                              <select name="clientId" className="input h-8 w-44 py-1 text-xs">{clients.map((cl) => <option key={cl.id} value={cl.id}>{cl.name}</option>)}</select>
                              <SubmitButton className="btn-secondary btn-sm">Assign</SubmitButton>
                            </ActionForm>
                          ))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!shown.length && <EmptyState title="No locations" />}
              </div>
            </Card>
          );
        })}
        {!conns.length && <Card><EmptyState title="No Google accounts connected" description="Connect the agency Google account that manages your clients' profiles." /></Card>}
      </div>
    </>
  );
}
