"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { audit } from "@/lib/audit";
import { packageToSettings } from "@/lib/services/onboarding";

export async function updateOrgAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_settings"], async (ctx) => {
    const before = ctx.org;
    const data = {
      name: z.string().min(2).max(120).parse(fd.str(f, "name")),
      whiteLabelName: fd.opt(f, "whiteLabelName"),
      timezone: fd.str(f, "timezone") || before.timezone,
      brandColor: /^#[0-9a-f]{6}$/i.test(fd.str(f, "brandColor")) ? fd.str(f, "brandColor") : before.brandColor,
      onboardingSlaHours: Math.min(720, Math.max(1, fd.int(f, "onboardingSlaHours", before.onboardingSlaHours))),
      observationDays: Math.min(90, Math.max(3, fd.int(f, "observationDays", before.observationDays))),
      minAutoConfidence: Math.min(0.99, Math.max(0.5, fd.num(f, "minAutoConfidence", before.minAutoConfidence * 100) / 100)),
      retentionDays: Math.min(3650, Math.max(30, fd.int(f, "retentionDays", before.retentionDays))),
    };
    await db.organization.update({ where: { id: ctx.orgId }, data });
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: "org.update", oldValue: before, newValue: data, source: "ui" });
    revalidatePath("/settings");
    return { ok: true, message: "Agency settings saved" };
  });
}

export async function savePackageAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_settings"], async (ctx) => {
    const id = fd.opt(f, "id");
    const data = {
      name: z.string().min(2).max(80).parse(fd.str(f, "name")), description: fd.opt(f, "description"), monthlyPrice: Math.round(fd.num(f, "price") * 100) || null,
      gbpPostsPerWeek: Math.min(7, Math.max(0, fd.int(f, "gbpPostsPerWeek"))), blogsPerMonth: Math.min(30, Math.max(0, fd.int(f, "blogsPerMonth"))),
      rankTracking: ["OFF", "WEEKLY", "DAILY"].includes(fd.str(f, "rankTracking")) ? fd.str(f, "rankTracking") : "WEEKLY", mapGrid: ["OFF", "WEEKLY", "MONTHLY"].includes(fd.str(f, "mapGrid")) ? fd.str(f, "mapGrid") : "OFF",
      supportCalls: fd.bool(f, "supportCalls"), websiteAutomation: fd.bool(f, "websiteAutomation"), reviewAutomation: fd.bool(f, "reviewAutomation"),
      reports: ["OFF", "WEEKLY", "MONTHLY", "BOTH"].includes(fd.str(f, "reports")) ? fd.str(f, "reports") : "MONTHLY",
    };
    const pkg = id
      ? await db.servicePackage.update({ where: { id: (await db.servicePackage.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } })).id }, data })
      : await db.servicePackage.create({ data: { ...data, organizationId: ctx.orgId } });
    // Package changes cascade into every client on the package (spec §60).
    if (id && fd.bool(f, "applyToClients")) {
      const clients = await db.client.findMany({ where: { organizationId: ctx.orgId, packageId: pkg.id }, select: { id: true } });
      for (const c of clients) await db.automationSetting.update({ where: { clientId: c.id }, data: packageToSettings(pkg) });
    }
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: id ? "package.update" : "package.create", entityType: "ServicePackage", entityId: pkg.id, newValue: data, source: "ui" });
    revalidatePath("/settings");
    return { ok: true, message: "Package saved" };
  });
}

export async function saveTemplateAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_settings"], async (ctx) => {
    const id = fd.opt(f, "id");
    let automation: Prisma.InputJsonValue;
    try {
      automation = JSON.parse(fd.str(f, "automation") || "{}");
    } catch {
      throw new Error("Automation defaults must be valid JSON");
    }
    const allowed = new Set(["postsPerWeek", "postDays", "blogsPerMonth", "blogsEnabled", "rankTracking", "mapGrid", "reviewAutoReply", "autoReply5", "autoReply4", "postsRequireApproval", "blogRequireApproval", "imageStyle", "monthlyReport", "weeklyReport", "level", "aiImagesGbp", "aiImagesBlog"]);
    const clean = Object.fromEntries(Object.entries(automation as Record<string, unknown>).filter(([k]) => allowed.has(k))) as Prisma.InputJsonValue;
    const data = { name: z.string().min(2).parse(fd.str(f, "name")), industry: fd.opt(f, "industry"), description: fd.opt(f, "description"), contentSafety: fd.opt(f, "contentSafety"), automation: clean };
    if (id) await db.clientTemplate.update({ where: { id: (await db.clientTemplate.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } })).id }, data });
    else await db.clientTemplate.create({ data: { ...data, organizationId: ctx.orgId } });
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: id ? "template.update" : "template.create", newValue: data, source: "ui" });
    revalidatePath("/settings");
    return { ok: true, message: "Template saved" };
  });
}
