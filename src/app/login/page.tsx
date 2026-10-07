import { redirect } from "next/navigation";
import { getCtx } from "@/lib/auth";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { loginAction } from "../actions/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage() {
  const ctx = await getCtx();
  if (ctx) redirect(ctx.isClientUser ? "/portal" : "/dashboard");
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="hidden flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-800 to-ink-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2 text-lg font-semibold"><Logo /> Local SEO Autopilot</div>
        <div>
          <h2 className="text-3xl font-semibold leading-tight">Connect once. The platform analyzes, plans, publishes, monitors and reports.</h2>
          <p className="mt-4 max-w-md text-brand-100">Your team handles relationships, approvals and exceptions. Routine local SEO work runs on autopilot — safely, audited and reversible.</p>
          <div className="mt-8 grid max-w-md grid-cols-3 gap-3 text-sm">
            {["GBP Autopilot", "Website SEO", "Support CRM"].map((t) => <div key={t} className="rounded-xl bg-white/10 px-3 py-2 backdrop-blur">{t}</div>)}
          </div>
        </div>
        <p className="text-xs text-brand-200">© {new Date().getFullYear()} Local SEO Autopilot</p>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 text-lg font-semibold lg:hidden"><Logo /> Local SEO Autopilot</div>
          <h1 className="text-2xl font-semibold tracking-tight">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-500">Sign in to your agency or client portal.</p>
          <ActionForm action={loginAction} className="mt-8 space-y-4" resetOnSuccess={false}>
            <Field label="Email"><input name="email" type="email" required autoComplete="email" className="input" placeholder="you@agency.com" /></Field>
            <Field label="Password"><input name="password" type="password" required autoComplete="current-password" className="input" /></Field>
            <SubmitButton className="btn-primary w-full" pendingText="Signing in…">Sign in</SubmitButton>
          </ActionForm>
          {process.env.NODE_ENV !== "production" && (
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

function Logo() {
  return (
    <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30 lg:bg-white/15">
      <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z" /></svg>
    </span>
  );
}
