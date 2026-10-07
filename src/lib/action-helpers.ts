import "server-only";
import { z } from "zod";
import { ForbiddenError, getCtx, type Ctx } from "./auth";
import type { Actor } from "./audit";
import type { PermissionKey } from "./permissions";

export type ActionResult = { ok: boolean; message?: string; error?: string; redirect?: string } | null;

/** Wrap a server action: requires a session + permissions, converts errors into form results. */
export async function guarded(perms: PermissionKey[], fn: (ctx: Ctx) => Promise<ActionResult | void>): Promise<ActionResult> {
  try {
    const ctx = await getCtx();
    if (!ctx) return { ok: false, error: "Your session has expired. Please sign in again." };
    for (const p of perms) if (!ctx.can(p)) throw new ForbiddenError(`You don't have permission (${p}).`);
    return (await fn(ctx)) ?? { ok: true };
  } catch (e) {
    if (e instanceof z.ZodError) return { ok: false, error: e.issues.map((i) => `${i.path.join(".") || "input"}: ${i.message}`).join("; ") };
    if (e instanceof ForbiddenError) return { ok: false, error: e.message };
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error("[action]", e);
    return { ok: false, error: (e as Error).message || "Something went wrong" };
  }
}

export function actorOf(ctx: Ctx): Actor & { memberId: string; orgId: string; roleKey: string } {
  return { type: ctx.isClientUser ? "CLIENT" : "HUMAN", id: ctx.memberId, memberId: ctx.memberId, userId: ctx.user.id, name: ctx.user.name, orgId: ctx.orgId, roleKey: ctx.roleKey };
}

export const fd = {
  str: (f: FormData, k: string) => {
    const v = f.get(k);
    return typeof v === "string" ? v.trim() : "";
  },
  opt: (f: FormData, k: string) => {
    const v = f.get(k);
    return typeof v === "string" && v.trim() ? v.trim() : null;
  },
  bool: (f: FormData, k: string) => ["on", "true", "1", "yes"].includes(String(f.get(k) ?? "")),
  list: (f: FormData, k: string) =>
    String(f.get(k) ?? "")
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean),
  all: (f: FormData, k: string) => f.getAll(k).map(String).filter(Boolean),
  int: (f: FormData, k: string, d = 0) => {
    const n = Number(f.get(k));
    return Number.isFinite(n) ? Math.round(n) : d;
  },
  num: (f: FormData, k: string, d = 0) => {
    const n = Number(f.get(k));
    return Number.isFinite(n) ? n : d;
  },
  date: (f: FormData, k: string) => {
    const v = f.get(k);
    if (typeof v !== "string" || !v) return null;
    const d = new Date(v);
    return Number.isNaN(d.getTime()) ? null : d;
  },
};
