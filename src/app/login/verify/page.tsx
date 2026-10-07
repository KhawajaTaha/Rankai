import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { ActionForm, Field, SubmitButton } from "@/components/client";
import { verifyTotpAction } from "../../actions/auth";

export default async function VerifyPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.twoFactorPending) redirect("/dashboard");
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="card card-pad w-full max-w-sm">
        <h1 className="text-lg font-semibold">Two-factor authentication</h1>
        <p className="mt-1 text-sm text-ink-500">Enter the 6-digit code from your authenticator app.</p>
        <ActionForm action={verifyTotpAction} className="mt-6 space-y-4" resetOnSuccess={false}>
          <Field label="Code"><input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} className="input text-center text-lg tracking-[0.4em]" required /></Field>
          <SubmitButton className="btn-primary w-full">Verify</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
