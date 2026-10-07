import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, KeyValue, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { TwoFactorSetup } from "@/components/two-factor";
import { disableTotpAction } from "@/app/actions/auth";

export const metadata = { title: "Settings" };

export default async function PortalSettings() {
  const ctx = await requirePortal();
  const [client, contacts, files] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: ctx.portalClientId } }),
    db.clientContact.findMany({ where: { clientId: ctx.portalClientId } }),
    db.fileAsset.findMany({ where: { clientId: ctx.portalClientId, clientVisible: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader title="Settings" subtitle="To change business details, send a request from Support." />
      <Card title="Business"><KeyValue items={[{ label: "Name", value: client.name }, { label: "Phone", value: client.phone }, { label: "Website", value: client.website }, { label: "Address", value: client.address }, { label: "Contacts", value: contacts.map((c) => c.name).join(", ") }]} /></Card>
      {files.length > 0 && <Card title="Shared files" pad={false}><ul className="divide-y divide-ink-100">{files.map((f) => <li key={f.id} className="px-5 py-2.5 text-sm"><a href={f.url} className="link" target="_blank" rel="noreferrer">{f.name}</a></li>)}</ul></Card>}
      <Card title="Two-factor authentication">{ctx.user.totpEnabled ? <div className="flex items-center justify-between"><span className="text-sm text-emerald-700">Enabled</span><ActionButton action={disableTotpAction}>Disable</ActionButton></div> : <TwoFactorSetup email={ctx.user.email} />}</Card>
    </div>
  );
}
