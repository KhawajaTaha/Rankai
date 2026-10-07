import crypto from "node:crypto";
import type { GoogleConnection } from "@prisma/client";
import { db } from "../db";
import { decrypt, encrypt, randomToken, sha256 } from "../crypto";
import { env, modes } from "../env";
import { raiseAlert } from "../notify";
import { createTask } from "../tasks";

export const GOOGLE_SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/business.manage",
  "https://www.googleapis.com/auth/webmasters.readonly",
  "https://www.googleapis.com/auth/analytics.readonly",
];

export const redirectUri = () => `${env.appUrl}/api/oauth/google/callback`;

/** Begin OAuth: persist hashed state + PKCE verifier server-side, return Google consent URL. */
export async function beginGoogleOAuth(args: { organizationId: string; userId: string; purpose: "AGENCY_GBP" | "CLIENT_GBP"; clientId?: string; returnTo?: string }) {
  const state = randomToken(24);
  const verifier = randomToken(48);
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  await db.oAuthState.create({
    data: {
      stateHash: sha256(state),
      organizationId: args.organizationId,
      userId: args.userId,
      purpose: args.purpose,
      clientId: args.clientId,
      codeVerifier: encrypt(verifier),
      returnTo: args.returnTo,
      expiresAt: new Date(Date.now() + 10 * 60_000),
    },
  });
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
    code_challenge: challenge,
    code_challenge_method: "S256",
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export async function consumeOAuthState(state: string) {
  const row = await db.oAuthState.findUnique({ where: { stateHash: sha256(state) } });
  if (!row) return null;
  await db.oAuthState.delete({ where: { id: row.id } });
  if (row.expiresAt < new Date()) return null;
  return { ...row, codeVerifier: row.codeVerifier ? decrypt(row.codeVerifier) : null };
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
}

export async function exchangeCode(code: string, verifier: string | null): Promise<TokenResponse> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      redirect_uri: redirectUri(),
      grant_type: "authorization_code",
      ...(verifier ? { code_verifier: verifier } : {}),
    }),
  });
  if (!res.ok) throw new Error(`Google token exchange failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<TokenResponse>;
}

export async function fetchGoogleUser(accessToken: string) {
  const res = await fetch("https://openidconnect.googleapis.com/v1/userinfo", { headers: { authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Google userinfo failed (${res.status})`);
  return res.json() as Promise<{ sub: string; email: string }>;
}

export class GoogleAuthError extends Error {}

/** Returns a valid access token, refreshing when needed. Never exposed to the browser. */
export async function getAccessToken(conn: GoogleConnection): Promise<string> {
  if (conn.mode === "DEMO") return "demo-token";
  if (!modes.googleLive()) throw new GoogleAuthError("Google OAuth credentials are not configured");
  if (conn.accessTokenEnc && conn.tokenExpiresAt && conn.tokenExpiresAt.getTime() > Date.now() + 60_000) return decrypt(conn.accessTokenEnc);
  if (!conn.refreshTokenEnc) {
    await markConnectionBroken(conn, "No refresh token stored — reconnect required");
    throw new GoogleAuthError("Google connection requires re-authorisation");
  }
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.googleClientId,
      client_secret: env.googleClientSecret,
      refresh_token: decrypt(conn.refreshTokenEnc),
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    if (res.status === 400 || res.status === 401) await markConnectionBroken(conn, `Token refresh rejected: ${body.slice(0, 150)}`);
    throw new GoogleAuthError(`Google token refresh failed (${res.status})`);
  }
  const t = (await res.json()) as TokenResponse;
  await db.googleConnection.update({
    where: { id: conn.id },
    data: { accessTokenEnc: encrypt(t.access_token), tokenExpiresAt: new Date(Date.now() + t.expires_in * 1000), status: "CONNECTED", lastError: null },
  });
  return t.access_token;
}

/** Failed Google auth → mark EXPIRED, alert, and create a reconnect request (spec §72). */
export async function markConnectionBroken(conn: GoogleConnection, reason: string) {
  await db.googleConnection.update({ where: { id: conn.id }, data: { status: "EXPIRED", lastError: reason } });
  const locations = await db.gbpLocation.findMany({ where: { account: { connectionId: conn.id }, clientId: { not: null } }, select: { clientId: true } });
  await raiseAlert({
    organizationId: conn.organizationId,
    severity: "CRITICAL",
    type: "gbp_disconnected",
    title: `Google connection ${conn.email} needs to be reconnected`,
    detail: `${reason}. ${locations.length} client profile(s) affected.`,
    dedupeKey: `google_conn_broken:${conn.id}`,
    link: "/settings/google-connections",
  });
  for (const l of locations) {
    await createTask({
      organizationId: conn.organizationId,
      clientId: l.clientId,
      title: "Reconnect Google Business Profile",
      description: `The Google account ${conn.email} lost authorisation. Reconnect it in Settings → Google Connections.`,
      category: "Integration",
      priority: "URGENT",
      source: "AUTOMATION",
      dedupeKey: `reconnect_gbp:${l.clientId}`,
    });
  }
}

export async function revokeGoogleToken(conn: GoogleConnection) {
  if (conn.mode === "DEMO" || !conn.refreshTokenEnc) return;
  await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(conn.refreshTokenEnc))}`, { method: "POST" }).catch(() => {});
}

/** Authenticated fetch against Google APIs with consistent error handling. */
export async function googleFetch<T>(conn: GoogleConnection, url: string, init: RequestInit = {}): Promise<T> {
  const token = await getAccessToken(conn);
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, "content-type": "application/json" } });
  if (res.status === 401) {
    await markConnectionBroken(conn, "Google returned 401 Unauthorized");
    throw new GoogleAuthError("Google rejected the access token");
  }
  if (!res.ok) throw new Error(`Google API ${res.status} on ${new URL(url).pathname}: ${(await res.text()).slice(0, 300)}`);
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}
