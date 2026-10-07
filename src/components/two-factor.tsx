"use client";

import { useState, useTransition } from "react";
import { ActionForm, Field, SubmitButton } from "./client";
import { beginTotpSetupAction, confirmTotpSetupAction } from "@/app/actions/auth";

export function TwoFactorSetup({ email }: { email: string }) {
  const [secret, setSecret] = useState<string | null>(null);
  const [pending, start] = useTransition();
  if (!secret) {
    return (
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-ink-600">Protect your account with an authenticator app (Google Authenticator, 1Password, Authy).</p>
        <button className="btn-primary btn-sm" disabled={pending} onClick={() => start(async () => { const r = await beginTotpSetupAction(); if (r?.ok && r.message) setSecret(r.message); })}>Set up 2FA</button>
      </div>
    );
  }
  const uri = `otpauth://totp/Local%20SEO%20Autopilot:${encodeURIComponent(email)}?secret=${secret}&issuer=Local%20SEO%20Autopilot`;
  return (
    <div className="space-y-3">
      <p className="text-sm text-ink-600">Add this key to your authenticator app, then enter the 6-digit code to confirm.</p>
      <div className="rounded-xl bg-ink-50 p-3 font-mono text-sm tracking-wider">{secret.match(/.{1,4}/g)?.join(" ")}</div>
      <p className="break-all text-[11px] text-ink-400">{uri}</p>
      <ActionForm action={confirmTotpSetupAction} className="flex items-end gap-2">
        <Field label="Code"><input name="code" inputMode="numeric" maxLength={6} className="input w-32 text-center tracking-widest" /></Field>
        <SubmitButton>Enable 2FA</SubmitButton>
      </ActionForm>
    </div>
  );
}
