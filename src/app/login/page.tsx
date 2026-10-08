import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { env } from "@/lib/env";
import { BRAND } from "@/lib/brand";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { loginAction } from "../actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const ctx = await getCtx();
  if (ctx) redirect(ctx.isClientUser ? "/portal" : "/dashboard");
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-800 via-brand-900 to-ink-900 p-12 text-white lg:flex">
        <div className="w-fit rounded-2xl bg-white px-5 py-3 shadow-pop">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt={BRAND.name} className="h-14 w-auto" />
        </div>
        <div>
          <div className="mb-3 inline-flex rounded-full bg-orange-500/20 px-3 py-1 text-xs font-semibold text-orange-200 ring-1 ring-orange-400/40">{BRAND.product}</div>
          <h2 className="text-3xl font-semibold leading-tight">Connect once. The platform analyzes, plans, publishes, monitors and reports.</h2>
          <p className="mt-4 max-w-md text-brand-100">Your team handles relationships, approvals and exceptions. Routine local SEO work runs on autopilot — safely, audited and reversible.</p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-sm">
            {["GBP Autopilot", "Website SEO", "Support CRM"].map((t) => <div key={t} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur">{t}</div>)}
          </div>
        </div>
        <p className="text-xs text-brand-200">© {new Date().getFullYear()} {BRAND.name}</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={BRAND.logo} alt={BRAND.name} className="mb-8 h-12 w-auto lg:hidden" />
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-500">Sign in to your {BRAND.name} workspace or client portal.</p>
          <ActionForm action={loginAction} className="mt-8 space-y-4" resetOnSuccess={false}>
            <Field label="Email"><input name="email" type="email" required autoComplete="email" className="input" placeholder="you@company.com" /></Field>
            <Field label="Password"><input name="password" type="password" required autoComplete="current-password" className="input" /></Field>
            <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
          </ActionForm>
          {!env.live && !env.isProd && (
            <div className="mt-8 rounded-xl border border-dashed border-ink-200 p-3 text-xs text-ink-500">
              <div className="mb-1 font-medium text-ink-700">Demo accounts (password <code>Autopilot!2026</code>)</div>
              admin@northpeak.example · maya@northpeak.example · support.manager@northpeak.example · seo.manager@northpeak.example · owner@superiorcustomgranite.example
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
