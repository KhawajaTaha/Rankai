import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader } from "@/components/ui";
import { ActionForm, Dialog, Field, SubmitButton, Toggle } from "@/components/client";
import { savePackageAction, saveTemplateAction, updateOrgAction } from "@/app/actions/settings";
import { saveSlaAction } from "@/app/actions/support";

export const metadata = { title: "Settings" };

export default async function SettingsPage() {
  const ctx = await requireStaff();
  const can = ctx.can("manage_settings");
  const [packages, templates, slas] = await Promise.all([
    db.servicePackage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { monthlyPrice: "asc" }, include: { _count: { select: { clients: true } } } }),
    db.clientTemplate.findMany({ where: { organizationId: ctx.orgId } }),
    db.slaPolicy.findMany({ where: { organizationId: ctx.orgId } }),
  ]);
  const org = ctx.org;
  const PackageForm = ({ p }: { p?: (typeof packages)[number] }) => (
    <ActionForm action={savePackageAction} resetOnSuccess={!p} className="grid gap-3 sm:grid-cols-2">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Name"><input name="name" defaultValue={p?.name} className="input" /></Field>
      <Field label="Monthly price"><input name="price" type="number" step="0.01" defaultValue={p?.monthlyPrice ? p.monthlyPrice / 100 : ""} className="input" /></Field>
      <Field label="GBP posts / week"><input name="gbpPostsPerWeek" type="number" defaultValue={p?.gbpPostsPerWeek ?? 2} className="input" /></Field>
      <Field label="Blogs / month"><input name="blogsPerMonth" type="number" defaultValue={p?.blogsPerMonth ?? 1} className="input" /></Field>
      <Field label="Rank tracking"><select name="rankTracking" defaultValue={p?.rankTracking ?? "WEEKLY"} className="input"><option>OFF</option><option>WEEKLY</option><option>DAILY</option></select></Field>
      <Field label="Map grid"><select name="mapGrid" defaultValue={p?.mapGrid ?? "OFF"} className="input"><option>OFF</option><option>WEEKLY</option><option>MONTHLY</option></select></Field>
      <Field label="Reports"><select name="reports" defaultValue={p?.reports ?? "MONTHLY"} className="input"><option>OFF</option><option>WEEKLY</option><option>MONTHLY</option><option>BOTH</option></select></Field>
      <Field label="Description"><input name="description" defaultValue={p?.description ?? ""} className="input" /></Field>
      <div className="sm:col-span-2">
        <Toggle name="supportCalls" label="Support calls included" defaultChecked={p?.supportCalls ?? true} />
        <Toggle name="websiteAutomation" label="Website automation enabled" defaultChecked={p?.websiteAutomation ?? false} />
        <Toggle name="reviewAutomation" label="Positive review auto-replies" defaultChecked={p?.reviewAutomation ?? true} />
        {p && <Toggle name="applyToClients" label={`Apply changes to the ${p._count.clients} client(s) on this package`} defaultChecked />}
      </div>
      <div className="sm:col-span-2"><SubmitButton>Save package</SubmitButton></div>
    </ActionForm>
  );
  return (
    <>
      <PageHeader title="Settings" actions={<><Link href="/settings/go-live" className="btn-primary">Go live</Link><Link href="/settings/google-connections" className="btn-secondary">Google Connections</Link><Link href="/settings/security" className="btn-secondary">Security & 2FA</Link>{ctx.can("view_audit_log") && <Link href="/audit-log" className="btn-secondary">Audit log</Link>}</>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Agency" subtitle="White label, safety thresholds and retention">
          <ActionForm action={updateOrgAction} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
            <Field label="Agency name"><input name="name" defaultValue={org.name} className="input" disabled={!can} /></Field>
            <Field label="White-label name"><input name="whiteLabelName" defaultValue={org.whiteLabelName ?? ""} className="input" disabled={!can} /></Field>
            <Field label="Timezone"><input name="timezone" defaultValue={org.timezone} className="input" disabled={!can} /></Field>
            <Field label="Brand color"><input name="brandColor" defaultValue={org.brandColor} className="input" disabled={!can} /></Field>
            <Field label="Onboarding SLA (hours)"><input name="onboardingSlaHours" type="number" defaultValue={org.onboardingSlaHours} className="input" disabled={!can} /></Field>
            <Field label="Change observation period (days)" hint="Cooldown before another major change to the same asset"><input name="observationDays" type="number" defaultValue={org.observationDays} className="input" disabled={!can} /></Field>
            <Field label="Minimum confidence for auto-execution (%)" hint="Lower-confidence actions always go to approval"><input name="minAutoConfidence" type="number" defaultValue={Math.round(org.minAutoConfidence * 100)} className="input" disabled={!can} /></Field>
            <Field label="Data retention after offboarding (days)"><input name="retentionDays" type="number" defaultValue={org.retentionDays} className="input" disabled={!can} /></Field>
            {can && <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>}
          </ActionForm>
        </Card>
        <Card title="Support SLA" subtitle="Respond-within targets per priority">
          <ActionForm action={saveSlaAction} resetOnSuccess={false} className="grid grid-cols-2 gap-3">
            {(["URGENT", "HIGH", "NORMAL", "LOW"] as const).map((p) => <Field key={p} label={`${p.charAt(0) + p.slice(1).toLowerCase()} — respond within (hours)`}><input name={`respond_${p}`} type="number" defaultValue={slas.find((s) => s.priority === p)?.respondWithinHours ?? 24} className="input" disabled={!ctx.can("manage_support")} /></Field>)}
            {ctx.can("manage_support") && <div className="col-span-2"><SubmitButton>Save SLA</SubmitButton></div>}
          </ActionForm>
        </Card>
        <Card title="Service packages" subtitle="Packages control features; changing a client's package updates its automations" pad={false} actions={can && <Dialog trigger="+ Package" title="New package" triggerClassName="btn-secondary btn-sm" wide><PackageForm /></Dialog>}>
          <ul className="divide-y divide-ink-100">
            {packages.map((p) => (
              <li key={p.id} className="flex items-center gap-3 px-5 py-3 text-sm">
                <div className="flex-1"><div className="font-medium">{p.name} {p.monthlyPrice ? <span className="text-xs font-normal text-ink-500">${(p.monthlyPrice / 100).toFixed(0)}/mo</span> : null}</div><div className="text-xs text-ink-500">{p.gbpPostsPerWeek} posts/wk · {p.blogsPerMonth} blogs/mo · ranks {p.rankTracking.toLowerCase()} · grid {p.mapGrid.toLowerCase()} · reports {p.reports.toLowerCase()} · {p._count.clients} clients</div></div>
                {can && <Dialog trigger="Edit" title={`Edit ${p.name}`} triggerClassName="btn-ghost btn-sm" wide><PackageForm p={p} /></Dialog>}
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Client templates" subtitle="Reusable onboarding / automation templates" pad={false} actions={can && (
          <Dialog trigger="+ Template" title="New template" triggerClassName="btn-secondary btn-sm" wide>
            <ActionForm action={saveTemplateAction} className="grid gap-3">
              <Field label="Name"><input name="name" className="input" /></Field>
              <Field label="Industry"><input name="industry" className="input" /></Field>
              <Field label="Description"><input name="description" className="input" /></Field>
              <Field label="Content safety profile"><input name="contentSafety" className="input" placeholder="e.g. healthcare-safe" /></Field>
              <Field label="Automation defaults (JSON)"><textarea name="automation" rows={5} className="input font-mono text-xs" defaultValue={'{"postsPerWeek":2,"postDays":[1,4],"blogsPerMonth":1,"blogsEnabled":true,"rankTracking":"WEEKLY","reviewAutoReply":"AUTO_POSITIVE"}'} /></Field>
              <SubmitButton>Create template</SubmitButton>
            </ActionForm>
          </Dialog>
        )}>
          <ul className="divide-y divide-ink-100">
            {templates.map((t) => (
              <li key={t.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between"><span className="font-medium">{t.name}</span>{can && (
                  <Dialog trigger="Edit" title={`Edit ${t.name}`} triggerClassName="btn-ghost btn-sm" wide>
                    <ActionForm action={saveTemplateAction} resetOnSuccess={false} className="grid gap-3">
                      <input type="hidden" name="id" value={t.id} />
                      <Field label="Name"><input name="name" defaultValue={t.name} className="input" /></Field>
                      <Field label="Industry"><input name="industry" defaultValue={t.industry ?? ""} className="input" /></Field>
                      <Field label="Description"><input name="description" defaultValue={t.description ?? ""} className="input" /></Field>
                      <Field label="Content safety profile"><input name="contentSafety" defaultValue={t.contentSafety ?? ""} className="input" /></Field>
                      <Field label="Automation defaults (JSON)"><textarea name="automation" rows={5} className="input font-mono text-xs" defaultValue={JSON.stringify(t.automation)} /></Field>
                      <SubmitButton>Save</SubmitButton>
                    </ActionForm>
                  </Dialog>
                )}</div>
                <div className="text-xs text-ink-500">{t.description}</div>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
