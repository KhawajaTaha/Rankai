"use client";

import { useState } from "react";
import { Check, ChevronLeft, ChevronRight } from "lucide-react";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { createClientAction } from "@/app/actions/clients";
import { cn } from "@/lib/utils";

const STEPS = ["Business", "Location & Services", "Online Presence", "Goals & Notes", "Package & Team"];

export function OnboardingWizard({ packages, templates, supportAgents, seoSpecialists, canAssign }: { packages: { id: string; name: string; description: string }[]; templates: { id: string; name: string; description: string | null }[]; supportAgents: { id: string; name: string }[]; seoSpecialists: { id: string; name: string }[]; canAssign: boolean }) {
  const [step, setStep] = useState(0);
  const [hasGbp, setHasGbp] = useState("yes");
  return (
    <ActionForm action={createClientAction} resetOnSuccess={false}>
      <ol className="mb-6 flex flex-wrap gap-2">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button type="button" onClick={() => setStep(i)} className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset", i === step ? "bg-brand-600 text-white ring-brand-600" : i < step ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : "bg-white text-ink-500 ring-ink-200")}>
              <span className={cn("inline-flex h-4 w-4 items-center justify-center rounded-full text-[10px]", i === step ? "bg-white/25" : i < step ? "bg-emerald-500 text-white" : "bg-ink-100")}>{i < step ? <Check className="h-3 w-3" /> : i + 1}</span>
              {s}
            </button>
          </li>
        ))}
      </ol>

      <div className="card card-pad">
        <section className={cn("grid gap-4 sm:grid-cols-2", step !== 0 && "hidden")}>
          <h2 className="col-span-full text-base font-semibold">Tell us about the business</h2>
          <Field label="Business name *"><input name="businessName" className="input" placeholder="Superior Custom Granite" /></Field>
          <Field label="Contact name *"><input name="contactName" className="input" placeholder="Who do we talk to?" /></Field>
          <Field label="Phone"><input name="phone" className="input" placeholder="(807) 555-0100" /></Field>
          <Field label="Email"><input name="email" type="email" className="input" placeholder="owner@business.com" /></Field>
          <Field label="Industry / type of business"><input name="industry" className="input" placeholder="e.g. Plumber, Dentist, Countertops" /></Field>
        </section>

        <section className={cn("grid gap-4 sm:grid-cols-2", step !== 1 && "hidden")}>
          <h2 className="col-span-full text-base font-semibold">Where are they, and what do they sell?</h2>
          <Field label="Business address" className="sm:col-span-2"><input name="address" className="input" placeholder="123 Main St" /></Field>
          <Field label="City"><input name="city" className="input" placeholder="Thunder Bay, ON" /></Field>
          <Field label="Locations served" hint="Comma separated"><input name="locationsServed" className="input" placeholder="Thunder Bay, Kakabeka Falls" /></Field>
          <Field label="Main services *" hint="Comma or line separated — the AI focuses on these" className="sm:col-span-2"><textarea name="services" rows={3} className="input" placeholder={"Granite countertops\nQuartz countertops\nKitchen countertop installation"} /></Field>
        </section>

        <section className={cn("grid gap-4 sm:grid-cols-2", step !== 2 && "hidden")}>
          <h2 className="col-span-full text-base font-semibold">Online presence</h2>
          <Field label="Website"><input name="website" className="input" placeholder="www.business.com" /></Field>
          <Field label="Website platform">
            <select name="websitePlatform" className="input" defaultValue="WordPress">
              {["WordPress", "Shopify", "Wix", "Squarespace", "Custom", "No website", "Not sure"].map((p) => <option key={p}>{p}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <span className="label">Google Business Profile available?</span>
            <input type="hidden" name="hasGbp" value={hasGbp} />
            <div className="flex gap-2">
              {[["yes", "Yes"], ["no", "No"], ["unsure", "Not sure"]].map(([v, l]) => (
                <button key={v} type="button" onClick={() => setHasGbp(v!)} className={cn("rounded-xl px-4 py-2 text-sm ring-1 ring-inset", hasGbp === v ? "bg-brand-50 font-medium text-brand-700 ring-brand-300" : "ring-ink-200 hover:bg-ink-50")}>{l}</button>
              ))}
            </div>
            <p className="mt-2 text-xs text-ink-500">A &quot;Connect Google Business Profile&quot; task is created automatically. The client can connect from their portal, or an admin can assign it from the agency Google account.</p>
          </div>
        </section>

        <section className={cn("grid gap-4", step !== 3 && "hidden")}>
          <h2 className="text-base font-semibold">Goals & notes</h2>
          <Field label="Main business goal"><input name="mainGoal" className="input" placeholder="More calls for kitchen countertop installs" /></Field>
          <Field label="Important notes" hint="Saved as a pinned note and added to the client's AI Business Brain"><textarea name="notes" rows={4} className="input" placeholder="Anything the team and AI should know — priorities, preferences, things to avoid…" /></Field>
        </section>

        <section className={cn("grid gap-4 sm:grid-cols-2", step !== 4 && "hidden")}>
          <h2 className="col-span-full text-base font-semibold">Package & team</h2>
          <Field label="Service package">
            <select name="packageId" className="input" defaultValue="">
              <option value="">Choose later</option>
              {packages.map((p) => <option key={p.id} value={p.id}>{p.name} — {p.description}</option>)}
            </select>
          </Field>
          <Field label="Automation template">
            <select name="templateId" className="input" defaultValue="">
              <option value="">None</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {canAssign ? (
            <>
              <Field label="Support agent" hint="Defaults to you if you're a support agent">
                <select name="supportAgentId" className="input" defaultValue="">
                  <option value="">Me / unassigned</option>
                  {supportAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="SEO specialist">
                <select name="seoSpecialistId" className="input" defaultValue="">
                  <option value="">Unassigned</option>
                  {seoSpecialists.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
            </>
          ) : (
            <p className="col-span-full rounded-xl bg-brand-50 px-3 py-2 text-xs text-brand-800">You&apos;ll be assigned as this client&apos;s support agent automatically.</p>
          )}
          <div className="col-span-full rounded-xl bg-ink-50 p-4 text-xs text-ink-600">
            <div className="mb-1 font-semibold text-ink-800">When you click Create, the platform sets up:</div>
            Client profile · Onboarding tasks (due within SLA) · SEO campaign & keywords · AI Business Brain · GBP connection task · Website audit · Support assignment · Initial baseline report
          </div>
        </section>
      </div>

      <div className="mt-4 flex items-center justify-between">
        <button type="button" className="btn-secondary" onClick={() => setStep(Math.max(0, step - 1))} disabled={step === 0}><ChevronLeft className="h-4 w-4" /> Back</button>
        {step < STEPS.length - 1 ? (
          <button type="button" className="btn-primary" onClick={() => setStep(step + 1)}>Next <ChevronRight className="h-4 w-4" /></button>
        ) : (
          <SubmitButton pendingText="Creating client…">Create client</SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}
