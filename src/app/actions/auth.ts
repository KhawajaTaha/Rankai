"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { clientIp, createSession, destroySession, getCtx, getSession, verifyPassword } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { decrypt, encrypt } from "@/lib/crypto";
import { rateLimit } from "@/lib/rate-limit";
import { generateTotpSecret, verifyTotp } from "@/lib/totp";
import type { ActionResult } from "@/lib/action-helpers";

export async function loginAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  const password = String(form.get("password") ?? "");
  const ip = (await clientIp()) ?? "unknown";
  if (!(await rateLimit(`login:ip:${ip}`, 20, 600)) || !(await rateLimit(`login:email:${email}`, 6, 600))) {
    return { ok: false, error: "Too many sign-in attempts. Please wait a few minutes and try again." };
  }
  const user = await db.user.findUnique({ where: { email }, include: { memberships: { where: { status: "ACTIVE" }, include: { role: true } } } });
  const ok = await verifyPassword(password, user?.passwordHash);
  if (!user || !ok || !user.memberships.length) {
    await audit({ organizationId: user?.memberships[0]?.organizationId ?? null, actor: { type: "HUMAN", userId: user?.id }, action: "auth.login_failed", newValue: { email }, ip, source: "ui" });
    return { ok: false, error: "Invalid email or password." };
  }
  const member = user.memberships[0]!;
  await createSession(user.id, member.organizationId, user.totpEnabled);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await audit({ organizationId: member.organizationId, actor: { type: "HUMAN", userId: user.id, id: member.id }, action: "auth.login", ip, source: "ui" });
  if (user.totpEnabled) redirect("/login/verify");
  redirect(member.role.isClientRole ? "/portal" : "/dashboard");
}

export async function verifyTotpAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const session = await getSession();
  if (!session) redirect("/login");
  const code = String(form.get("code") ?? "");
  if (!(await rateLimit(`totp:${session.userId}`, 6, 300))) return { ok: false, error: "Too many attempts. Wait a few minutes." };
  if (!session.user.totpSecretEnc || !verifyTotp(decrypt(session.user.totpSecretEnc), code)) return { ok: false, error: "That code is not valid." };
  await db.session.update({ where: { id: session.id }, data: { twoFactorPending: false } });
  redirect("/dashboard");
}

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchOrgAction(orgId: string) {
  const session = await getSession();
  if (!session) redirect("/login");
  const member = await db.organizationUser.findFirst({ where: { userId: session.userId, organizationId: orgId, status: "ACTIVE" } });
  if (member) await db.session.update({ where: { id: session.id }, data: { organizationId: orgId } });
  redirect("/dashboard");
}

export async function beginTotpSetupAction(): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!ctx) return { ok: false, error: "Not signed in" };
  const secret = generateTotpSecret();
  await db.user.update({ where: { id: ctx.user.id }, data: { totpSecretEnc: encrypt(secret), totpEnabled: false } });
  return { ok: true, message: secret };
}

export async function confirmTotpSetupAction(_prev: ActionResult, form: FormData): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!ctx) return { ok: false, error: "Not signed in" };
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.user.id } });
  if (!user.totpSecretEnc || !verifyTotp(decrypt(user.totpSecretEnc), String(form.get("code") ?? ""))) return { ok: false, error: "Code did not match. Try again." };
  await db.user.update({ where: { id: user.id }, data: { totpEnabled: true } });
  await audit({ organizationId: ctx.orgId, actor: { type: "HUMAN", userId: user.id, id: ctx.memberId }, action: "auth.2fa_enabled", source: "ui" });
  return { ok: true, message: "Two-factor authentication is now enabled." };
}

export async function disableTotpAction(): Promise<ActionResult> {
  const ctx = await getCtx();
  if (!ctx) return { ok: false, error: "Not signed in" };
  await db.user.update({ where: { id: ctx.user.id }, data: { totpEnabled: false, totpSecretEnc: null } });
  await audit({ organizationId: ctx.orgId, actor: { type: "HUMAN", userId: ctx.user.id, id: ctx.memberId }, action: "auth.2fa_disabled", source: "ui" });
  return { ok: true, message: "Two-factor authentication disabled." };
}
