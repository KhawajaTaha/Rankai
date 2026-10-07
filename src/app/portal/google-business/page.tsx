import { MapPin } from "lucide-react";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { modes } from "@/lib/env";
import { Card, DemoBadge, KeyValue, PageHeader, ScoreRing, StatusBadge, fmtDate } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { assignLocationAction, connectGoogleAction } from "@/app/actions/google";

export const metadata = { title: "Google Business" };

export default async function PortalGbp() {
  const ctx = await requirePortal();
  const id = ctx.portalClientId;
  const [client, loc, posts] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id } }),
    db.gbpLocation.findFirst({ where: { clientId: id }, include: { account: { include: { connection: true } } } }),
    db.gbpPost.findMany({ where: { clientId: id }, orderBy: { publishedAt: "desc" }, take: 6 }),
  ]);
  if (!loc) {
    const own = await db.gbpLocation.findMany({ where: { organizationId: ctx.orgId, clientId: null, account: { connection: { clientId: id, status: "CONNECTED" } } } });
    return (
      <>
        <PageHeader title="Google Business Profile" />
        <Card title="Connect your Google Business Profile" subtitle="Sign in with the Google account that manages your business profile and approve access. You can disconnect at any time.">
          {own.length ? (
            <ActionForm action={assignLocationAction.bind(null, id)} className="space-y-3">
              <p className="text-sm text-ink-600">Choose your business location:</p>
              <select name="locationId" className="input">{own.map((l) => <option key={l.id} value={l.id}>{l.title} — {l.address}</option>)}</select>
              <SubmitButton>Use this location</SubmitButton>
            </ActionForm>
          ) : ctx.can("portal_connect_gbp") ? (
            <form action={connectGoogleAction.bind(null, "CLIENT_GBP", id)}>
              <button className="btn-primary"><MapPin className="h-4 w-4" /> Connect Google Business Profile</button>
              {!modes.googleLive() && <p className="mt-2 text-xs text-amber-700">Demo Mode: a sample connection will be created.</p>}
            </form>
          ) : <p className="text-sm text-ink-500">Ask the account owner to connect the profile.</p>}
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHeader title="Google Business Profile" subtitle={<span className="inline-flex items-center gap-2">{loc.title} <StatusBadge status={loc.account.connection.status} /> {loc.account.connection.mode === "DEMO" && <DemoBadge />}</span>} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Profile score"><div className="flex items-center gap-4"><ScoreRing score={client.gbpScore} size={72} /><p className="text-sm text-ink-600">We keep your profile complete, active and responsive so more local customers find you.</p></div></Card>
        <Card title="Your listing" className="lg:col-span-2"><KeyValue items={[{ label: "Name", value: loc.title }, { label: "Category", value: loc.primaryCategory }, { label: "Phone", value: loc.phone }, { label: "Website", value: loc.websiteUri }, { label: "Address", value: loc.address }, { label: "Last updated", value: fmtDate(loc.lastSyncAt) }]} /><p className="mt-3 text-sm text-ink-600">{loc.description}</p></Card>
        <Card title="Recent posts" className="lg:col-span-3" pad={false}><ul className="divide-y divide-ink-100">{posts.map((p) => <li key={p.id} className="px-5 py-3 text-sm"><p className="line-clamp-2 text-ink-700">{p.summary}</p><div className="text-xs text-ink-400">{fmtDate(p.publishedAt)}</div></li>)}</ul></Card>
      </div>
    </>
  );
}
