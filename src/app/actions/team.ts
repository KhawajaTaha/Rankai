"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { hashPassword } from "@/lib/auth";
import { assertClientAccess } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { randomToken } from "@/lib/crypto";
import { sendEmail } from "@/lib/email";
import { env } from "@/lib/env";
import { PERMISSIONS } from "@/lib/permissions";

async function createOrAttachUser(orgId: string, email: string, name: string, roleId: string, clientId: string | null, title?: string | null) {
  const temp = randomToken(9);
  let user = await db.user.findUnique({ where: { email } });
  if (!user) user = await db.user.create({ data: { email, name, passwordHash: await hashPassword(temp) } });
  if (await db.organizationUser.findUnique({ where: { organizationId_userId: { organizationId: orgId, userId: user.id } } })) throw new Error("That person is already a member");
  const member = await db.organizationUser.create({ data: { organizationId: orgId, userId: user.id, roleId, clientId, title } });
  await sendEmail({ to: email, subject: "You've been invited to Local SEO Autopilot", text: `Hi ${name},\n\nYou've been given access. Sign in at ${env.appUrl}/login with this email and temporary password: ${temp}\n\nPlease change it after signing in.` });
  return { member, temp };
}

export async function inviteStaffAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_team"], async (ctx) => {
    const email = z.email().parse(fd.str(f, "email").toLowerCase());
    const role = await db.role.findFirstOrThrow({ where: { id: fd.str(f, "roleId"), organizationId: ctx.orgId, isClientRole: false } });
    if (role.key === "super_admin" && !ctx.user.isSuperAdmin) throw new Error("Only super admins can grant Super Admin");
    const { member, temp } = await createOrAttachUser(ctx.orgId, email, z.string().min(2).parse(fd.str(f, "name")), role.id, null, fd.opt(f, "title"));
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "team.invite", entityType: "OrganizationUser", entityId: member.id, newValue: { email, role: role.key }, source: "ui" });
    revalidatePath("/team");
    return { ok: true, message: `Invited. Temporary password (shown once): ${temp}` };
  });
}

export async function inviteClientUserAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["edit_client"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const email = z.email().parse(fd.str(f, "email").toLowerCase());
    const role = await db.role.findFirstOrThrow({ where: { organizationId: ctx.orgId, key: fd.str(f, "role") === "client_staff" ? "client_staff" : "client_owner" } });
    const { member, temp } = await createOrAttachUser(ctx.orgId, email, z.string().min(2).parse(fd.str(f, "name")), role.id, clientId, null);
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "portal.invite", entityType: "OrganizationUser", entityId: member.id, newValue: { email, role: role.key }, source: "ui" });
    revalidatePath(`/clients/${clientId}/settings`);
    return { ok: true, message: `Portal access created. Temporary password (shown once): ${temp}` };
  });
}

export async function updateMemberAction(memberId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_team"], async (ctx) => {
    const m = await db.organizationUser.findFirstOrThrow({ where: { id: memberId, organizationId: ctx.orgId }, include: { role: true } });
    const role = await db.role.findFirstOrThrow({ where: { id: fd.str(f, "roleId") || m.roleId, organizationId: ctx.orgId } });
    if (role.key === "super_admin" && !ctx.user.isSuperAdmin) throw new Error("Only super admins can grant Super Admin");
    if (m.id === ctx.memberId && fd.str(f, "status") === "DISABLED") throw new Error("You can't disable yourself");
    const valid = Object.keys(PERMISSIONS);
    const granted = fd.all(f, "grant").filter((p) => valid.includes(p) && !role.permissions.includes(p));
    const revoked = fd.all(f, "revoke").filter((p) => valid.includes(p) && role.permissions.includes(p));
    const status = ["ACTIVE", "DISABLED"].includes(fd.str(f, "status")) ? fd.str(f, "status") : m.status;
    await db.organizationUser.update({ where: { id: m.id }, data: { roleId: role.id, grantedPermissions: granted, revokedPermissions: revoked, status: status as "ACTIVE", title: fd.opt(f, "title") } });
    if (status === "DISABLED") await db.session.deleteMany({ where: { userId: m.userId } });
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "team.update", entityType: "OrganizationUser", entityId: m.id, oldValue: { role: m.role.key, granted: m.grantedPermissions, revoked: m.revokedPermissions, status: m.status }, newValue: { role: role.key, granted, revoked, status }, source: "ui" });
    revalidatePath("/team");
    return { ok: true, message: "Saved" };
  });
}

export async function saveRoleAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_team"], async (ctx) => {
    const valid = Object.keys(PERMISSIONS);
    const perms = fd.all(f, "perm").filter((p) => valid.includes(p));
    const id = fd.opt(f, "roleId");
    if (id) {
      const role = await db.role.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } });
      if (role.key === "super_admin") throw new Error("Super Admin permissions can't be edited");
      await db.role.update({ where: { id }, data: { permissions: perms } });
      await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "role.update", entityType: "Role", entityId: id, oldValue: role.permissions, newValue: perms, source: "ui" });
    } else {
      const name = z.string().min(2).max(60).parse(fd.str(f, "name"));
      const role = await db.role.create({ data: { organizationId: ctx.orgId, key: `custom_${randomToken(4).toLowerCase()}`, name, permissions: perms, isClientRole: false } });
      await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "role.create", entityType: "Role", entityId: role.id, newValue: perms, source: "ui" });
    }
    revalidatePath("/team");
    return { ok: true, message: "Role saved" };
  });
}
