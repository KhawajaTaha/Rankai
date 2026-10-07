import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { clientAssignmentsMap } from "@/lib/queries";
import { Badge, Card, Tabs, timeAgo } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/client";
import { assignTeamAction, offboardAction, toggleKnowledgeEntryAction, updateBrandKitAction, updateClientProfileAction, updateKnowledgeAction } from "@/app/actions/clients";
import { inviteClientUserAction } from "@/app/actions/team";
import { pretty } from "@/lib/labels";

const SUB = ["profile", "brain", "brand-kit", "team", "portal", "offboarding"];

export default async function ClientSettings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getAccessibleClient(ctx, id);
  const tab = SUB.includes(sp.tab ?? "") ? sp.tab! : "profile";
  const base = `/clients/${id}/settings`;
  const [k, brand, entries, assigned, members, portalUsers] = await Promise.all([
    db.clientKnowledge.findUniqueOrThrow({ where: { clientId: id } }),
    db.clientBrandKit.findUniqueOrThrow({ where: { clientId: id } }),
    db.knowledgeEntry.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    clientAssignmentsMap([id]),
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { isClientRole: false } }, include: { user: true, role: true } }),
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, clientId: id }, include: { user: true, role: true } }),
  ]);
  const a = assigned.get(id) ?? {};
  const can = ctx.can("edit_client");
  const contentAssignee = (await db.clientAssignment.findFirst({ where: { clientId: id, type: "CONTENT" } }))?.memberId;
  const faqs = (k.faqs as { question: string; answer: string }[]) ?? [];

  return (
    <div className="space-y-5">
      <Tabs active={`${base}?tab=${tab}`} tabs={SUB.map((s) => ({ href: `${base}?tab=${s}`, label: s === "brain" ? "AI Business Brain" : pretty(s.replace("-", " ")) }))} />
      {tab === "profile" && (
        <Card title="Business information">
          <ActionForm action={updateClientProfileAction.bind(null, id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
            {([["name", "Business name", client.name], ["phone", "Phone", client.phone], ["email", "Email", client.email], ["website", "Website", client.website], ["address", "Address", client.address], ["city", "City", client.city], ["industry", "Industry", client.industry], ["websitePlatform", "Website platform", client.websitePlatform], ["mainGoal", "Main goal", client.mainGoal]] as const).map(([n, l, v]) => (
              <Field key={n} label={l}><input name={n} defaultValue={v ?? ""} className="input" disabled={!can} /></Field>
            ))}
            {can && <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div>}
          </ActionForm>
        </Card>
      )}
      {tab === "brain" && (
        <div className="grid gap-5 xl:grid-cols-3">
          <Card title="AI Business Brain" subtitle={`Version ${k.version} · updated ${timeAgo(k.updatedAt)} · every AI action uses this context`} className="xl:col-span-2">
            <ActionForm action={updateKnowledgeAction.bind(null, id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-2">
              <Field label="Business name"><input name="businessName" defaultValue={k.businessName} className="input" /></Field>
              <Field label="Industry"><input name="industry" defaultValue={k.industry ?? ""} className="input" /></Field>
              <Field label="Location"><input name="location" defaultValue={k.location ?? ""} className="input" /></Field>
              <Field label="Service areas" hint="comma separated"><input name="serviceAreas" defaultValue={k.serviceAreas.join(", ")} className="input" /></Field>
              <Field label="Services" className="sm:col-span-2"><textarea name="services" rows={2} defaultValue={k.services.join(", ")} className="input" /></Field>
              <Field label="Products"><input name="products" defaultValue={k.products.join(", ")} className="input" /></Field>
              <Field label="Important keywords"><input name="importantKeywords" defaultValue={k.importantKeywords.join(", ")} className="input" /></Field>
              <Field label="Services to prioritize"><input name="prioritizeServices" defaultValue={k.prioritizeServices.join(", ")} className="input" /></Field>
              <Field label="Services NOT to promote"><input name="doNotPromote" defaultValue={k.doNotPromote.join(", ")} className="input" /></Field>
              <Field label="Words to avoid"><input name="wordsToAvoid" defaultValue={k.wordsToAvoid.join(", ")} className="input" /></Field>
              <Field label="Brand tone"><input name="brandTone" defaultValue={k.brandTone ?? ""} className="input" /></Field>
              <Field label="USP" className="sm:col-span-2"><textarea name="usp" rows={2} defaultValue={k.usp ?? ""} className="input" /></Field>
              <Field label="Target audience"><input name="targetAudience" defaultValue={k.targetAudience ?? ""} className="input" /></Field>
              <Field label="Seasonal offers"><input name="seasonalOffers" defaultValue={k.seasonalOffers ?? ""} className="input" /></Field>
              <Field label="Content preferences" className="sm:col-span-2"><textarea name="contentPreferences" rows={2} defaultValue={k.contentPreferences ?? ""} className="input" /></Field>
              <Field label="Brand guidelines" className="sm:col-span-2"><textarea name="brandGuidelines" rows={2} defaultValue={k.brandGuidelines ?? ""} className="input" /></Field>
              <Field label="Special instructions" className="sm:col-span-2"><textarea name="specialInstructions" rows={2} defaultValue={k.specialInstructions ?? ""} className="input" /></Field>
              <Field label="FAQs" hint="One per line: question | answer" className="sm:col-span-2"><textarea name="faqs" rows={3} defaultValue={faqs.map((x) => `${x.question} | ${x.answer}`).join("\n")} className="input" /></Field>
              {can && <div className="sm:col-span-2"><SubmitButton>Save brain</SubmitButton></div>}
            </ActionForm>
          </Card>
          <div className="space-y-5">
            <Card title="Learned context" subtitle="From support notes, client requests, GBP & website syncs" pad={false}>
              <ul className="divide-y divide-ink-100">
                {entries.map((e) => (
                  <li key={e.id} className="px-5 py-3 text-sm">
                    <div className="flex items-center gap-2"><Badge tone={e.active ? "purple" : "gray"}>{pretty(e.source)}</Badge><span className="text-[11px] text-ink-400">{timeAgo(e.createdAt)}</span>{can && <span className="ml-auto"><ActionButton action={toggleKnowledgeEntryAction.bind(null, e.id)} className="btn-ghost btn-sm">{e.active ? "Disable" : "Use as context"}</ActionButton></span>}</div>
                    <p className={`mt-1 ${e.active ? "text-ink-700" : "text-ink-400 line-through"}`}>{e.content}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Synced summaries">
              <p className="text-xs text-ink-500">GBP: {k.gbpSummary ?? "—"}</p>
              <p className="mt-2 text-xs text-ink-500">Website: {k.websiteSummary ?? "—"}</p>
            </Card>
          </div>
        </div>
      )}
      {tab === "brand-kit" && (
        <Card title="Brand Kit" subtitle="The AI content & image generators follow these">
          <ActionForm action={updateBrandKitAction.bind(null, id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-3">
            <Field label="Logo" className="sm:col-span-3"><div className="flex items-center gap-3">{brand.logoUrl && (  <img src={brand.logoUrl} alt="logo" className="h-12 w-12 rounded-lg object-contain ring-1 ring-ink-200" />)}<input name="logo" type="file" accept="image/*" className="input py-1.5 text-xs" /></div></Field>
            {([["primaryColor", "Primary", brand.primaryColor], ["secondaryColor", "Secondary", brand.secondaryColor], ["accentColor", "Accent", brand.accentColor]] as const).map(([n, l, v]) => <Field key={n} label={`${l} color`}><div className="flex gap-2"><input type="color" defaultValue={v} className="h-9 w-12 rounded-lg border border-ink-200" aria-hidden /><input name={n} defaultValue={v} className="input" /></div></Field>)}
            <Field label="Heading font"><input name="headingFont" defaultValue={brand.headingFont} className="input" /></Field>
            <Field label="Body font"><input name="bodyFont" defaultValue={brand.bodyFont} className="input" /></Field>
            <Field label="Brand tone"><input name="brandTone" defaultValue={brand.brandTone} className="input" /></Field>
            <Field label="Image style"><select name="imageStyle" defaultValue={brand.imageStyle} className="input">{["Photo-realistic", "Professional", "Luxury", "Clean", "Modern", "Healthcare", "Automotive", "Home Services", "Corporate", "Travel"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            <Field label="CTA style"><input name="ctaStyle" defaultValue={brand.ctaStyle} className="input" /></Field>
            <Field label="Preferred design style"><select name="designStyle" defaultValue={brand.designStyle} className="input">{["Minimal", "Premium", "Bold", "Corporate", "Luxury", "Friendly", "Local", "Clean", "Modern"].map((x) => <option key={x}>{x}</option>)}</select></Field>
            {can && <div className="sm:col-span-3"><SubmitButton>Save Brand Kit</SubmitButton></div>}
          </ActionForm>
          <p className="mt-3 text-[11px] text-ink-400">Tip: edit the hex value; the swatch is a visual reference.</p>
        </Card>
      )}
      {tab === "team" && (
        <Card title="Assigned team">
          {ctx.can("assign_clients") ? (
            <ActionForm action={assignTeamAction.bind(null, id)} resetOnSuccess={false} className="grid gap-3 sm:grid-cols-3">
              <Field label="Support agent"><select name="support" defaultValue={a.supportId ?? ""} className="input"><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name} ({m.role.name})</option>)}</select></Field>
              <Field label="SEO specialist"><select name="seo" defaultValue={a.seoId ?? ""} className="input"><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name} ({m.role.name})</option>)}</select></Field>
              <Field label="Content"><select name="content" defaultValue={contentAssignee ?? ""} className="input"><option value="">Unassigned</option>{members.map((m) => <option key={m.id} value={m.id}>{m.user.name} ({m.role.name})</option>)}</select></Field>
              <div className="sm:col-span-3"><SubmitButton>Save team</SubmitButton></div>
            </ActionForm>
          ) : <p className="text-sm">Support: {a.support ?? "—"} · SEO: {a.seo ?? "—"}</p>}
        </Card>
      )}
      {tab === "portal" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Client portal users" pad={false}>
            <ul className="divide-y divide-ink-100">{portalUsers.map((u) => <li key={u.id} className="px-5 py-3 text-sm"><span className="font-medium">{u.user.name}</span> <Badge>{u.role.name}</Badge><div className="text-xs text-ink-500">{u.user.email} · last login {timeAgo(u.user.lastLoginAt)}</div></li>)}</ul>
            {!portalUsers.length && <p className="px-5 py-4 text-sm text-ink-500">No portal users yet.</p>}
          </Card>
          {can && (
            <Card title="Invite to portal">
              <ActionForm action={inviteClientUserAction.bind(null, id)} className="space-y-3">
                <Field label="Name"><input name="name" className="input" /></Field>
                <Field label="Email"><input name="email" type="email" className="input" /></Field>
                <Field label="Access"><select name="role" className="input"><option value="client_owner">Client Owner (approvals, connect GBP)</option><option value="client_staff">Client Staff (restricted)</option></select></Field>
                <SubmitButton>Create access</SubmitButton>
              </ActionForm>
            </Card>
          )}
        </div>
      )}
      {tab === "offboarding" && (
        <Card title="Offboard client" subtitle="Safe offboarding — never deletes the client's GBP or website data">
          <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-ink-700">
            <li>Pause all automations and cancel queued jobs</li><li>Generate a final report</li><li>Remove scheduled content</li><li>Optionally release integrations (GBP assignment & stored website credentials)</li><li>Archive the client — history is retained per the agency retention policy</li>
          </ol>
          {ctx.can("delete_client") ? (
            <ActionForm action={offboardAction.bind(null, id)} className="max-w-md space-y-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="revoke" className="h-4 w-4 rounded" defaultChecked /> Release integrations</label>
              <Field label={`Type "${client.name}" to confirm`}><input name="confirm" className="input" autoComplete="off" /></Field>
              <SubmitButton className="btn-danger">Start offboarding</SubmitButton>
            </ActionForm>
          ) : <p className="text-sm text-ink-500">You don&apos;t have permission to offboard clients.</p>}
        </Card>
      )}
    </div>
  );
}
