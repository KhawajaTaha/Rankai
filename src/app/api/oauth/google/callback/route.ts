import { NextResponse, type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { env } from "@/lib/env";
import { audit } from "@/lib/audit";
import { consumeOAuthState, exchangeCode, fetchGoogleUser } from "@/lib/integrations/google-oauth";
import { syncConnectionLocations } from "@/lib/services/gbp";
import { getSession } from "@/lib/auth";

/** Google OAuth callback: validates hashed state + PKCE, stores encrypted tokens server-side only. */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const fail = (msg: string) => NextResponse.redirect(new URL(`/settings/google-connections?error=${encodeURIComponent(msg)}`, env.appUrl));
  if (error) return fail(error);
  if (!code || !state) return fail("missing_code");
  const st = await consumeOAuthState(state);
  if (!st) return fail("invalid_or_expired_state");
  const session = await getSession();
  if (!session || session.userId !== st.userId) return fail("session_mismatch");
  try {
    const tokens = await exchangeCode(code, st.codeVerifier);
    const user = await fetchGoogleUser(tokens.access_token);
    const existing = await db.googleConnection.findUnique({ where: { organizationId_email: { organizationId: st.organizationId, email: user.email } } });
    const data = {
      googleUserId: user.sub,
      mode: "LIVE" as const,
      status: "CONNECTED" as const,
      scopes: (tokens.scope ?? "").split(" ").filter(Boolean),
      accessTokenEnc: encrypt(tokens.access_token),
      refreshTokenEnc: tokens.refresh_token ? encrypt(tokens.refresh_token) : existing?.refreshTokenEnc ?? null,
      tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000),
      lastError: null,
    };
    const member = await db.organizationUser.findFirst({ where: { organizationId: st.organizationId, userId: st.userId } });
    const conn = existing
      ? await db.googleConnection.update({ where: { id: existing.id }, data })
      : await db.googleConnection.create({ data: { ...data, organizationId: st.organizationId, email: user.email, ownerType: st.purpose === "AGENCY_GBP" ? "AGENCY" : "CLIENT", clientId: st.clientId, connectedById: member?.id } });
    await audit({ organizationId: st.organizationId, clientId: st.clientId, actor: { type: st.purpose === "CLIENT_GBP" && !member ? "CLIENT" : "HUMAN", userId: st.userId, id: member?.id }, action: "google.connect", entityType: "GoogleConnection", entityId: conn.id, newValue: { email: user.email, scopes: data.scopes }, source: "oauth" });
    await syncConnectionLocations(conn.id);
    const dest = st.returnTo ?? "/settings/google-connections";
    return NextResponse.redirect(new URL(`${dest}${dest.includes("?") ? "&" : "?"}select=${conn.id}`, env.appUrl));
  } catch (e) {
    console.error("[oauth] callback failed", e);
    return fail("token_exchange_failed");
  }
}
