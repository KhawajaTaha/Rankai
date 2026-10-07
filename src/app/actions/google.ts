"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { getCtx } from "@/lib/auth";
import { assertClientAccess } from "@/lib/tenancy";
import { audit } from "@/lib/audit";
import { modes } from "@/lib/env";
import { beginGoogleOAuth, revokeGoogleToken } from "@/lib/integrations/google-oauth";
import { assignLocation, syncConnectionLocations, unassignLocation } from "@/lib/services/gbp";
import { enqueue } from "@/lib/jobs/queue";

/** Start Google OAuth (live) or create a clearly-labelled Demo connection when no credentials exist. */
export async function connectGoogleAction(purpose: "AGENCY_GBP" | "CLIENT_GBP", clientId?: string) {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const allowed = purpose === "AGENCY_GBP" ? ctx.can("connect_gbp") : ctx.can("connect_gbp") || ctx.can("portal_connect_gbp");
  if (!allowed) throw new Error("Not allowed");
  if (clientId) await assertClientAccess(ctx, clientId);
  if (modes.googleLive()) {
    const url = await beginGoogleOAuth({ organizationId: ctx.orgId, userId: ctx.user.id, purpose, clientId, returnTo: purpose === "AGENCY_GBP" ? "/settings/google-connections" : ctx.isClientUser ? "/portal/google-business" : `/clients/${clientId}/gbp` });
    redirect(url);
  }
  // Demo mode: simulate the OAuth outcome with mocked data so the full workflow is usable.
  const email = purpose === "AGENCY_GBP" ? `agency-demo-${Date.now().toString(36)}@demo.example` : `client-demo-${clientId?.slice(-6)}@demo.example`;
  const conn = await db.googleConnection.create({ data: { organizationId: ctx.orgId, ownerType: purpose === "AGENCY_GBP" ? "AGENCY" : "CLIENT", clientId: purpose === "CLIENT_GBP" ? clientId : null, email, mode: "DEMO", status: "CONNECTED", scopes: ["business.manage"], connectedById: ctx.memberId } });
  await syncConnectionLocations(conn.id);
  await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "google.connect", entityType: "GoogleConnection", entityId: conn.id, newValue: { email, mode: "DEMO" }, source: ctx.isClientUser ? "portal" : "ui" });
  redirect(purpose === "AGENCY_GBP" ? "/settings/google-connections?connected=1" : ctx.isClientUser ? "/portal/google-business?select=1" : `/clients/${clientId}/gbp?select=${conn.id}`);
}

export async function assignLocationAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded([], async (ctx) => {
    if (!ctx.can("connect_gbp") && !(ctx.isClientUser && ctx.can("portal_connect_gbp"))) throw new Error("Not allowed to connect profiles");
    await assertClientAccess(ctx, clientId);
    const locationId = fd.str(f, "locationId");
    if (ctx.isClientUser) {
      // Clients may only pick locations from a connection they made themselves.
      const loc = await db.gbpLocation.findFirst({ where: { id: locationId, organizationId: ctx.orgId, account: { connection: { clientId } } } });
      if (!loc) throw new Error("Choose one of your own Google locations");
    }
    await assignLocation({ organizationId: ctx.orgId, locationId, clientId, actor: actorOf(ctx) });
    revalidatePath(`/clients/${clientId}`, "layout");
    revalidatePath("/settings/google-connections");
    return { ok: true, message: "Profile assigned — syncing now." };
  });
}

export async function assignLocationFromCenterAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["connect_gbp"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    await assignLocation({ organizationId: ctx.orgId, locationId: fd.str(f, "locationId"), clientId, actor: actorOf(ctx) });
    revalidatePath("/settings/google-connections");
    return { ok: true, message: "Assigned." };
  });
}

export async function unassignLocationAction(locationId: string) {
  return guarded(["connect_gbp"], async (ctx) => {
    await unassignLocation({ organizationId: ctx.orgId, locationId, actor: actorOf(ctx) });
    revalidatePath("/settings/google-connections");
  });
}

export async function syncConnectionAction(connectionId: string) {
  return guarded(["connect_gbp"], async (ctx) => {
    const c = await db.googleConnection.findFirstOrThrow({ where: { id: connectionId, organizationId: ctx.orgId } });
    await syncConnectionLocations(c.id);
    revalidatePath("/settings/google-connections");
    return { ok: true, message: "Synced" };
  });
}

export async function disconnectGoogleAction(connectionId: string) {
  return guarded(["connect_gbp"], async (ctx) => {
    const c = await db.googleConnection.findFirstOrThrow({ where: { id: connectionId, organizationId: ctx.orgId } });
    await revokeGoogleToken(c);
    // Profiles stay on Google; we only drop our access + assignments.
    await db.gbpLocation.updateMany({ where: { account: { connectionId: c.id } }, data: { clientId: null } });
    await db.googleConnection.update({ where: { id: c.id }, data: { status: "DISCONNECTED", accessTokenEnc: null, refreshTokenEnc: null } });
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "google.disconnect", entityType: "GoogleConnection", entityId: c.id, source: "ui" });
    revalidatePath("/settings/google-connections");
  });
}

export async function syncClientGbpAction(clientId: string) {
  return guarded(["manage_gbp"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    await enqueue("gbp.sync", { clientId }, { organizationId: ctx.orgId, clientId, label: "GBP sync (manual)", triggeredBy: "HUMAN", priority: 2 });
    return { ok: true, message: "Sync queued" };
  });
}
