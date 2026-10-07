import "server-only";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { db } from "./db";
import { randomToken, sha256 } from "./crypto";
import { effectivePermissions, type PermissionKey } from "./permissions";

const COOKIE = "lsa_session";
const SESSION_DAYS = 14;

export class ForbiddenError extends Error {
  constructor(message = "You do not have permission to perform this action") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export async function hashPassword(pw: string) {
  return bcrypt.hash(pw, 12);
}

export async function verifyPassword(pw: string, hash: string) {
  return bcrypt.compare(pw, hash);
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

export async function createSession(userId: string, organizationId: string | null, twoFactorPending = false) {
  const token = randomToken(32);
  const h = await headers();
  await db.session.create({
    data: {
      userId,
      organizationId,
      tokenHash: sha256(token),
      twoFactorPending,
      ip: await clientIp(),
      userAgent: h.get("user-agent")?.slice(0, 255) ?? null,
      expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000),
    },
  });
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_DAYS * 86_400,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(COOKIE);
}

async function loadSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const session = await db.session.findUnique({ where: { tokenHash: sha256(token) }, include: { user: true } });
  if (!session || session.expiresAt < new Date()) return null;
  if (Date.now() - session.lastSeenAt.getTime() > 5 * 60_000) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return session;
}

export const getSession = cache(loadSession);

export type Experience = "agency" | "support" | "client";

export type Ctx = NonNullable<Awaited<ReturnType<typeof buildCtx>>>;

async function buildCtx() {
  const session = await getSession();
  if (!session || session.twoFactorPending) return null;
  const memberships = await db.organizationUser.findMany({
    where: { userId: session.userId, status: "ACTIVE" },
    include: { role: true, organization: true },
    orderBy: { createdAt: "asc" },
  });
  const member = memberships.find((m) => m.organizationId === session.organizationId) ?? memberships[0];
  if (!member) return null;
  const permissions = effectivePermissions(member.role.permissions, member.grantedPermissions, member.revokedPermissions);
  if (session.user.isSuperAdmin) for (const p of effectivePermissions(member.role.permissions)) permissions.add(p);
  const roleKey = member.role.key;
  const experience: Experience = member.role.isClientRole ? "client" : roleKey === "support_agent" ? "support" : "agency";
  return {
    user: session.user,
    sessionId: session.id,
    member,
    memberId: member.id,
    orgId: member.organizationId,
    org: member.organization,
    roleKey,
    roleName: member.role.name,
    permissions,
    experience,
    isClientUser: member.role.isClientRole,
    portalClientId: member.clientId,
    memberships: memberships.map((m) => ({ orgId: m.organizationId, orgName: m.organization.name, role: m.role.name })),
    can: (p: PermissionKey) => permissions.has(p),
  };
}

export const getCtx = cache(buildCtx);

export async function requireCtx() {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  return ctx;
}

export async function requireStaff() {
  const ctx = await requireCtx();
  if (ctx.isClientUser) redirect("/portal");
  return ctx;
}

export async function requirePortal() {
  const ctx = await requireCtx();
  if (!ctx.isClientUser || !ctx.portalClientId) redirect("/dashboard");
  return ctx as typeof ctx & { portalClientId: string };
}

export function assertCan(ctx: Ctx | null, ...perms: PermissionKey[]) {
  if (!ctx) throw new ForbiddenError("Not signed in");
  for (const p of perms) if (!ctx.permissions.has(p)) throw new ForbiddenError(`Missing permission: ${p}`);
}

export function canAny(ctx: Ctx, ...perms: PermissionKey[]) {
  return perms.some((p) => ctx.permissions.has(p));
}
