"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { actorOf, fd, guarded, type ActionResult } from "@/lib/action-helpers";
import { assertClientAccess } from "@/lib/tenancy";
import { activity, audit } from "@/lib/audit";
import { enqueue } from "@/lib/jobs/queue";
import { createTask } from "@/lib/tasks";
import { createClientFromWizard, normalizeUrl, packageToSettings, refreshOnboarding } from "@/lib/services/onboarding";
import { addNote, completeFollowUp, logCall, processMentions } from "@/lib/services/support";
import { offboardClient } from "@/lib/services/offboarding";
import { generateAiImage } from "@/lib/images/generate";
import { encryptJson, randomToken } from "@/lib/crypto";
import { saveFile, mimeFor } from "@/lib/storage";
import { addDays } from "@/lib/utils";
import { askClientAssistant } from "@/lib/services/assistant";

const WizardSchema = z.object({
  businessName: z.string().min(2, "Business name is required").max(120),
  contactName: z.string().min(2, "Contact name is required").max(120),
  phone: z.string().max(40).optional(),
  email: z.union([z.email(), z.literal("")]).optional(),
  website: z.string().max(200).optional(),
  address: z.string().max(200).optional(),
  city: z.string().max(80).optional(),
  industry: z.string().max(80).optional(),
  services: z.array(z.string().max(80)).min(1, "Add at least one main service").max(30),
  locationsServed: z.array(z.string().max(80)).max(30),
  hasGbp: z.enum(["yes", "no", "unsure"]),
  websitePlatform: z.string().max(40).optional(),
  mainGoal: z.string().max(300).optional(),
  notes: z.string().max(4000).optional(),
  packageId: z.string().optional(),
  templateId: z.string().optional(),
  supportAgentId: z.string().optional(),
  seoSpecialistId: z.string().optional(),
});

export async function createClientAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_client"], async (ctx) => {
    const input = WizardSchema.parse({
      businessName: fd.str(f, "businessName"), contactName: fd.str(f, "contactName"), phone: fd.str(f, "phone"), email: fd.str(f, "email"), website: fd.str(f, "website"),
      address: fd.str(f, "address"), city: fd.str(f, "city"), industry: fd.str(f, "industry"), services: fd.list(f, "services"), locationsServed: fd.list(f, "locationsServed"),
      hasGbp: fd.str(f, "hasGbp") || "unsure", websitePlatform: fd.str(f, "websitePlatform"), mainGoal: fd.str(f, "mainGoal"), notes: fd.str(f, "notes"),
      packageId: fd.str(f, "packageId") || undefined, templateId: fd.str(f, "templateId") || undefined,
      supportAgentId: ctx.can("assign_clients") ? fd.str(f, "supportAgentId") || undefined : undefined,
      seoSpecialistId: ctx.can("assign_clients") ? fd.str(f, "seoSpecialistId") || undefined : undefined,
    });
    // Assignees must belong to this organisation.
    for (const id of [input.supportAgentId, input.seoSpecialistId].filter(Boolean)) {
      if (!(await db.organizationUser.findFirst({ where: { id: id!, organizationId: ctx.orgId } }))) throw new Error("Invalid assignee");
    }
    for (const [model, id] of [["servicePackage", input.packageId], ["clientTemplate", input.templateId]] as const) {
      if (id && !(await (db[model] as unknown as { findFirst: (a: object) => Promise<unknown> }).findFirst({ where: { id, organizationId: ctx.orgId } }))) throw new Error("Invalid package/template");
    }
    const client = await createClientFromWizard(ctx.orgId, { ...input, email: input.email || undefined }, actorOf(ctx));
    revalidatePath("/clients");
    return { ok: true, message: "Client created — onboarding tasks, SEO campaign and AI brain are ready.", redirect: `/clients/${client.id}` };
  });
}

export async function updateClientProfileAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["edit_client"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const before = await db.client.findUniqueOrThrow({ where: { id: clientId } });
    const data = {
      name: fd.str(f, "name") || before.name, phone: fd.opt(f, "phone"), email: fd.opt(f, "email"), website: fd.opt(f, "website") ? normalizeUrl(fd.str(f, "website")) : null,
      address: fd.opt(f, "address"), city: fd.opt(f, "city"), industry: fd.opt(f, "industry"), mainGoal: fd.opt(f, "mainGoal"), websitePlatform: fd.opt(f, "websitePlatform"),
    };
    await db.client.update({ where: { id: clientId }, data });
    if (data.website && !(await db.website.findFirst({ where: { clientId } }))) await db.website.create({ data: { organizationId: ctx.orgId, clientId, url: data.website, platform: data.websitePlatform?.toLowerCase() } });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "client.update", entityType: "Client", entityId: clientId, oldValue: before, newValue: data, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "CLIENT", type: "client.updated", title: "Business information updated", actor: actorOf(ctx) });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function assignTeamAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["assign_clients"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    for (const type of ["SUPPORT", "SEO", "CONTENT"] as const) {
      const memberId = fd.str(f, type.toLowerCase());
      await db.clientAssignment.deleteMany({ where: { clientId, type } });
      if (memberId) {
        if (!(await db.organizationUser.findFirst({ where: { id: memberId, organizationId: ctx.orgId } }))) throw new Error("Invalid team member");
        await db.clientAssignment.create({ data: { organizationId: ctx.orgId, clientId, memberId, type } });
      }
    }
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "client.assign", newValue: Object.fromEntries(f.entries()), source: "ui" });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Team updated" };
  });
}

// ───────────────────────── Quick actions ─────────────────────────

export async function addCallAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["add_calls"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const date = fd.str(f, "date") || new Date().toISOString().slice(0, 10);
    const time = fd.str(f, "time") || new Date().toTimeString().slice(0, 5);
    const occurredAt = new Date(`${date}T${time}`);
    const followUpRequired = fd.str(f, "followUpRequired") === "yes";
    await logCall(actorOf(ctx), {
      clientId, contactName: fd.str(f, "contactName"), occurredAt, direction: fd.str(f, "direction") === "INCOMING" ? "INCOMING" : "OUTGOING",
      outcome: (["ANSWERED", "NO_ANSWER", "VOICEMAIL", "BUSY"].includes(fd.str(f, "outcome")) ? fd.str(f, "outcome") : "ANSWERED") as "ANSWERED",
      durationMin: fd.opt(f, "duration") ? fd.int(f, "duration") : null, purpose: fd.str(f, "purpose"), discussion: fd.str(f, "discussion"), result: fd.str(f, "result"),
      followUpRequired, followUpDate: followUpRequired ? fd.date(f, "followUpDate") ?? addDays(new Date(), 2) : null, tags: fd.all(f, "tags"),
    });
    revalidatePath(`/clients/${clientId}`, "layout");
    revalidatePath("/support/calls");
    return { ok: true, message: followUpRequired ? "Call logged — follow-up task and reminder created." : "Call logged." };
  });
}

export async function addNoteAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["add_notes"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const body = z.string().min(2).max(5000).parse(fd.str(f, "body"));
    let attachmentUrl: string | null = null;
    const file = f.get("attachment");
    if (file instanceof File && file.size > 0) {
      if (file.size > 10_000_000) throw new Error("Attachment too large (10MB max)");
      attachmentUrl = (await saveFile(ctx.orgId, clientId, file.name, Buffer.from(await file.arrayBuffer()))).url;
    }
    await addNote(actorOf(ctx), {
      clientId, body, category: fd.str(f, "category") || "General", priority: (["LOW", "NORMAL", "HIGH", "URGENT"].includes(fd.str(f, "priority")) ? fd.str(f, "priority") : "NORMAL") as "NORMAL",
      visibility: fd.str(f, "visibility") === "CLIENT_VISIBLE" ? "CLIENT_VISIBLE" : "INTERNAL", useAsAiContext: fd.bool(f, "useAsAiContext"), pinned: fd.bool(f, "pinned"), attachmentUrl,
    });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: fd.bool(f, "useAsAiContext") ? "Note saved and added to the AI Business Brain." : "Note saved." };
  });
}

export async function togglePinNoteAction(noteId: string) {
  return guarded(["add_notes"], async (ctx) => {
    const n = await db.supportNote.findFirstOrThrow({ where: { id: noteId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, n.clientId);
    await db.supportNote.update({ where: { id: noteId }, data: { pinned: !n.pinned } });
    revalidatePath(`/clients/${n.clientId}`, "layout");
  });
}

export async function createTaskAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_tasks"], async (ctx) => {
    const clientId = fd.opt(f, "clientId");
    if (clientId) await assertClientAccess(ctx, clientId);
    const assignee = fd.opt(f, "assignedToId");
    if (assignee && !(await db.organizationUser.findFirst({ where: { id: assignee, organizationId: ctx.orgId } }))) throw new Error("Invalid assignee");
    const dependsOnId = fd.opt(f, "dependsOnId");
    const { task } = await createTask({
      organizationId: ctx.orgId, clientId, title: z.string().min(2).max(200).parse(fd.str(f, "title")), description: fd.str(f, "description"),
      category: fd.str(f, "category") || "General", priority: (["LOW", "NORMAL", "HIGH", "URGENT"].includes(fd.str(f, "priority")) ? fd.str(f, "priority") : "NORMAL") as "NORMAL",
      dueAt: fd.date(f, "dueAt") ?? undefined, assignedToId: assignee ?? ctx.memberId, source: "HUMAN", createdById: ctx.memberId, actor: actorOf(ctx),
    });
    if (dependsOnId) await db.task.update({ where: { id: task.id }, data: { dependsOnId } });
    await processMentions(actorOf(ctx), `${task.title} ${task.description ?? ""}`, { clientId, entityType: "Task", entityId: task.id, link: `/tasks?task=${task.id}` });
    revalidatePath("/tasks");
    if (clientId) revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Task created." };
  });
}

export async function quickJobAction(clientId: string, kind: string): Promise<ActionResult> {
  const PERMS: Record<string, Parameters<typeof guarded>[0]> = {
    gbp_audit: ["run_audit"], website_audit: ["run_audit"], ranks: ["manage_keywords"], grid: ["manage_keywords"], report: ["generate_reports"], gbp_sync: ["manage_gbp"],
    strategy: ["run_audit"], plan: ["create_content"], gsc: ["manage_website"], ga4: ["manage_website"], competitors: ["manage_keywords"], health: ["view_reports"],
  };
  const JOBS: Record<string, [string, string, Record<string, unknown>?]> = {
    gbp_audit: ["gbp.audit", "GBP audit (manual)"], website_audit: ["website.crawl", "Website audit (manual)"], ranks: ["ranks.check", "Ranking check (manual)"], grid: ["grid.check", "Local grid (manual)"],
    report: ["report.generate", "Report (manual)", { type: "MONTHLY_SEO" }], gbp_sync: ["gbp.sync", "GBP sync (manual)"], strategy: ["strategy.weekly", "Weekly strategy (manual)"],
    plan: ["content.plan", "Plan content calendar (manual)"], gsc: ["gsc.sync", "Search Console sync (manual)"], ga4: ["ga4.sync", "GA4 sync (manual)"], competitors: ["competitors.analyze", "Competitor analysis (manual)"], health: ["health.update", "Health score update"],
  };
  const job = JOBS[kind];
  if (!job) return { ok: false, error: "Unknown action" };
  return guarded(PERMS[kind] ?? ["run_audit"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    await enqueue(job[0], { clientId, ...(job[2] ?? {}) }, { organizationId: ctx.orgId, clientId, label: job[1], triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 2 });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: `${job[1]} queued — results appear shortly.` };
  });
}

export async function generateContentAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_content"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const type = fd.str(f, "type") === "BLOG" ? "BLOG" : "GBP_POST";
    const loc = await db.gbpLocation.findFirst({ where: { clientId } });
    if (type === "GBP_POST" && !loc) throw new Error("Connect a Google Business Profile first.");
    const when = fd.date(f, "scheduledFor") ?? addDays(new Date(), 2);
    const item = await db.contentItem.create({
      data: { organizationId: ctx.orgId, clientId, locationId: loc?.id, type, status: "GENERATING", title: fd.str(f, "topic") || (type === "BLOG" ? "Blog" : "GBP post"), topic: fd.opt(f, "topic"), category: fd.opt(f, "category") ?? (type === "GBP_POST" ? "Service" : null), servicePromoted: fd.opt(f, "service"), scheduledFor: when, createdById: ctx.memberId, generatedBy: "HUMAN" },
    });
    await enqueue("content.generate", { contentItemId: item.id }, { organizationId: ctx.orgId, clientId, label: `Generate ${type === "BLOG" ? "blog" : "GBP post"}`, triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 2, dedupeKey: `gen:${item.id}` });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: `${type === "BLOG" ? "Blog" : "GBP post"} is being generated with the client's AI brain — it will appear in Content shortly.` };
  });
}

export async function generateImageAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_content"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const consent = await db.clientConsent.findUnique({ where: { clientId } });
    if (!consent?.aiImages) throw new Error("This client has not consented to AI-generated images (Automations → Consent).");
    const concept = z.string().min(5).max(400).parse(fd.str(f, "concept"));
    await generateAiImage({ organizationId: ctx.orgId, clientId, purpose: (fd.str(f, "purpose") || "GBP_POST") as "GBP_POST", concept, mode: "REQUIRE_APPROVAL" });
    await activity({ organizationId: ctx.orgId, clientId, category: "AI", type: "image.generated", title: "AI image generated", detail: concept, actor: actorOf(ctx) });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: `Image generated and saved to Media Library (AI Generated) for review.` };
  });
}

export async function addKeywordAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_keywords"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const phrases = fd.list(f, "phrases").slice(0, 50);
    if (!phrases.length) throw new Error("Enter at least one keyword");
    const group = fd.str(f, "group") || "PRIMARY";
    const location = fd.opt(f, "location");
    let added = 0;
    for (const phrase of phrases) {
      const exists = await db.keyword.findFirst({ where: { clientId, phrase: phrase.toLowerCase(), location } });
      if (exists) continue;
      await db.keyword.create({ data: { organizationId: ctx.orgId, clientId, phrase: phrase.toLowerCase(), group, location, targetUrl: fd.opt(f, "targetUrl") } });
      added++;
    }
    await enqueue("ranks.check", { clientId }, { organizationId: ctx.orgId, clientId, label: "Rank check for new keywords", triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 3 });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: `${added} keyword(s) added — first positions are being checked.` };
  });
}

export async function deleteKeywordAction(keywordId: string) {
  return guarded(["manage_keywords"], async (ctx) => {
    const k = await db.keyword.findFirstOrThrow({ where: { id: keywordId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, k.clientId);
    await db.keyword.delete({ where: { id: k.id } });
    revalidatePath(`/clients/${k.clientId}`, "layout");
  });
}

export async function addCompetitorAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_keywords"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    await db.competitor.create({ data: { organizationId: ctx.orgId, clientId, name: z.string().min(2).max(120).parse(fd.str(f, "name")), website: fd.opt(f, "website"), gbpCategory: fd.opt(f, "category"), services: fd.list(f, "services") } });
    await enqueue("competitors.analyze", { clientId }, { organizationId: ctx.orgId, clientId, label: "Competitor analysis", triggeredBy: "HUMAN", priority: 3 });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Competitor added — analysis queued." };
  });
}

export async function requestClientApprovalAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["create_content"], async (ctx) => {
    const clientId = fd.str(f, "clientId");
    await assertClientAccess(ctx, clientId);
    const approval = await db.approval.create({
      data: { organizationId: ctx.orgId, clientId, category: (fd.str(f, "category") || "CONTENT") as "CONTENT", title: z.string().min(3).max(200).parse(fd.str(f, "title")), beforeValue: fd.opt(f, "current"), afterValue: fd.opt(f, "recommended"), reason: fd.opt(f, "reason"), requiresClient: true, risk: "MEDIUM" },
    });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "approval.request_client", entityType: "Approval", entityId: approval.id, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "CLIENT", type: "approval.requested", title: `Client approval requested: ${approval.title}`, actor: actorOf(ctx) });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Approval request sent to the client portal." };
  });
}

export async function setAutomationPausedAction(clientId: string, paused: boolean): Promise<ActionResult> {
  return guarded(["pause_automation"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    await db.client.update({ where: { id: clientId }, data: { automationPaused: paused } });
    if (paused) await db.automationRun.updateMany({ where: { clientId, status: { in: ["QUEUED", "RETRYING"] }, type: { in: ["content.publish", "recommendation.execute", "content.generate"] } }, data: { status: "CANCELLED", completedAt: new Date(), lastError: "Cancelled: automation paused" } });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: paused ? "automation.pause" : "automation.resume", source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "SYSTEM", type: paused ? "automation.paused" : "automation.resumed", title: paused ? "Automation paused" : "Automation resumed", actor: actorOf(ctx) });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: paused ? "Automation paused" : "Automation resumed" };
  });
}

export async function completeFollowUpAction(id: string) {
  return guarded(["add_calls"], async (ctx) => {
    const f = await db.followUp.findFirstOrThrow({ where: { id, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, f.clientId);
    await completeFollowUp(id, ctx.orgId, actorOf(ctx));
    revalidatePath("/support/follow-ups");
    revalidatePath(`/clients/${f.clientId}`, "layout");
  });
}

// ───────────────────────── Brain, brand kit, automation, consent ─────────────────────────

export async function updateKnowledgeAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["edit_client"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const before = await db.clientKnowledge.findUniqueOrThrow({ where: { clientId } });
    let faqs: Prisma.InputJsonValue = before.faqs as Prisma.InputJsonValue;
    const faqText = fd.str(f, "faqs");
    if (faqText) faqs = faqText.split("\n").map((l) => l.split("|")).filter((p) => p.length >= 2).map(([q, a]) => ({ question: q!.trim(), answer: a!.trim() }));
    const data = {
      businessName: fd.str(f, "businessName") || before.businessName, industry: fd.opt(f, "industry"), location: fd.opt(f, "location"), serviceAreas: fd.list(f, "serviceAreas"), services: fd.list(f, "services"),
      products: fd.list(f, "products"), usp: fd.opt(f, "usp"), targetAudience: fd.opt(f, "targetAudience"), brandTone: fd.opt(f, "brandTone"), importantKeywords: fd.list(f, "importantKeywords"),
      seasonalOffers: fd.opt(f, "seasonalOffers"), contentPreferences: fd.opt(f, "contentPreferences"), prioritizeServices: fd.list(f, "prioritizeServices"), doNotPromote: fd.list(f, "doNotPromote"),
      wordsToAvoid: fd.list(f, "wordsToAvoid"), brandGuidelines: fd.opt(f, "brandGuidelines"), specialInstructions: fd.opt(f, "specialInstructions"), faqs, version: { increment: 1 },
    };
    await db.clientKnowledge.update({ where: { clientId }, data });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "knowledge.update", entityType: "ClientKnowledge", entityId: before.id, oldValue: before, newValue: data, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "AI", type: "knowledge.updated", title: "AI Business Brain updated", actor: actorOf(ctx) });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "AI Business Brain saved. Every AI action will use the new context." };
  });
}

export async function toggleKnowledgeEntryAction(entryId: string) {
  return guarded(["edit_client"], async (ctx) => {
    const e = await db.knowledgeEntry.findFirstOrThrow({ where: { id: entryId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, e.clientId);
    await db.knowledgeEntry.update({ where: { id: e.id }, data: { active: !e.active } });
    revalidatePath(`/clients/${e.clientId}`, "layout");
  });
}

export async function updateBrandKitAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["edit_client"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const hex = z.string().regex(/^#[0-9a-fA-F]{6}$/, "Colors must be hex like #1f48f5");
    let logoUrl: string | undefined;
    const file = f.get("logo");
    if (file instanceof File && file.size > 0) {
      if (!/^image\//.test(file.type) || file.size > 5_000_000) throw new Error("Logo must be an image under 5MB");
      const saved = await saveFile(ctx.orgId, clientId, file.name, Buffer.from(await file.arrayBuffer()));
      logoUrl = saved.url;
      await db.mediaAsset.create({ data: { organizationId: ctx.orgId, clientId, folder: "LOGO", url: saved.url, filename: file.name, mimeType: file.type, sizeBytes: file.size, status: "APPROVED", title: "Logo", uploadedById: ctx.memberId } });
      await db.client.update({ where: { id: clientId }, data: { logoUrl } });
    }
    const data = {
      primaryColor: hex.parse(fd.str(f, "primaryColor")), secondaryColor: hex.parse(fd.str(f, "secondaryColor")), accentColor: hex.parse(fd.str(f, "accentColor")),
      headingFont: fd.str(f, "headingFont") || "Inter", bodyFont: fd.str(f, "bodyFont") || "Inter", brandTone: fd.str(f, "brandTone"), imageStyle: fd.str(f, "imageStyle"),
      ctaStyle: fd.str(f, "ctaStyle"), designStyle: fd.str(f, "designStyle"), ...(logoUrl ? { logoUrl } : {}),
    };
    await db.clientBrandKit.update({ where: { clientId }, data });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "brandkit.update", newValue: data, source: "ui" });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Brand Kit saved." };
  });
}

const LEVELS = ["MONITOR_ONLY", "ASSIST", "APPROVAL_AUTOPILOT", "FULL_SAFE_AUTOPILOT"] as const;
const IMG = ["OFF", "DRAFT_ONLY", "REQUIRE_APPROVAL", "AUTO_USE"] as const;

export async function updateAutomationAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_automations"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const before = await db.automationSetting.findUniqueOrThrow({ where: { clientId } });
    const pick = <T extends readonly string[]>(arr: T, v: string, d: T[number]) => ((arr as readonly string[]).includes(v) ? v : d) as T[number];
    const data: Prisma.AutomationSettingUpdateInput = {
      level: pick(LEVELS, fd.str(f, "level"), before.level),
      gbpPostingEnabled: fd.bool(f, "gbpPostingEnabled"), postsPerWeek: Math.min(7, Math.max(0, fd.int(f, "postsPerWeek", before.postsPerWeek))),
      postDays: fd.all(f, "postDays").map(Number).filter((n) => n >= 0 && n <= 6), postTime: /^\d{2}:\d{2}$/.test(fd.str(f, "postTime")) ? fd.str(f, "postTime") : before.postTime,
      autoGenerateCopy: fd.bool(f, "autoGenerateCopy"), autoGenerateImage: fd.bool(f, "autoGenerateImage"), autoPublishPosts: fd.bool(f, "autoPublishPosts"), postsRequireApproval: fd.bool(f, "postsRequireApproval"),
      contentCategories: fd.list(f, "contentCategories"), ctaPreference: fd.str(f, "ctaPreference") || before.ctaPreference,
      aiImagesGbp: pick(IMG, fd.str(f, "aiImagesGbp"), before.aiImagesGbp), aiImagesBlog: pick(IMG, fd.str(f, "aiImagesBlog"), before.aiImagesBlog), aiImagesSocial: pick(IMG, fd.str(f, "aiImagesSocial"), before.aiImagesSocial),
      aiImagesReports: pick(IMG, fd.str(f, "aiImagesReports"), before.aiImagesReports), aiImagesWebsite: pick(IMG, fd.str(f, "aiImagesWebsite"), before.aiImagesWebsite),
      preferRealPhotos: fd.bool(f, "preferRealPhotos"), imageAddLogo: fd.bool(f, "imageAddLogo"), imageAddText: fd.bool(f, "imageAddText"), imageStyle: fd.str(f, "imageStyle") || before.imageStyle, imageDimensions: /^\d{3,4}x\d{3,4}$/.test(fd.str(f, "imageDimensions")) ? fd.str(f, "imageDimensions") : before.imageDimensions,
      blogsEnabled: fd.bool(f, "blogsEnabled"), blogsPerMonth: Math.min(30, Math.max(0, fd.int(f, "blogsPerMonth", before.blogsPerMonth))), blogRequireApproval: fd.bool(f, "blogRequireApproval"), blogAutoPublish: fd.bool(f, "blogAutoPublish"),
      blogFeaturedImage: fd.bool(f, "blogFeaturedImage"), blogMinWords: Math.min(5000, Math.max(300, fd.int(f, "blogMinWords", before.blogMinWords))), blogTone: fd.opt(f, "blogTone"), blogTargetServices: fd.list(f, "blogTargetServices"), blogTargetLocations: fd.list(f, "blogTargetLocations"),
      blogDays: fd.all(f, "blogDays").map(Number).filter((n) => n >= 0 && n <= 6),
      reviewAutoReply: pick(["NEVER", "APPROVAL_ALL", "AUTO_POSITIVE"] as const, fd.str(f, "reviewAutoReply"), before.reviewAutoReply), autoReply5: fd.bool(f, "autoReply5"), autoReply4: fd.bool(f, "autoReply4"),
      websiteSafeFixes: fd.bool(f, "websiteSafeFixes"), rankTracking: pick(["OFF", "WEEKLY", "DAILY"] as const, fd.str(f, "rankTracking"), before.rankTracking as "WEEKLY"),
      mapGrid: pick(["OFF", "WEEKLY", "MONTHLY"] as const, fd.str(f, "mapGrid"), before.mapGrid as "OFF"), gridSize: [3, 5, 7].includes(fd.int(f, "gridSize")) ? fd.int(f, "gridSize") : before.gridSize, gridRadiusKm: Math.min(50, Math.max(1, fd.num(f, "gridRadiusKm", before.gridRadiusKm))),
      weeklyReport: fd.bool(f, "weeklyReport"), monthlyReport: fd.bool(f, "monthlyReport"), reportDay: Math.min(28, Math.max(0, fd.int(f, "reportDay", before.reportDay))), reportRecipients: fd.list(f, "reportRecipients").filter((e) => /@/.test(e)),
      reportAutoEmail: fd.bool(f, "reportAutoEmail"), reportWhiteLabel: fd.bool(f, "reportWhiteLabel"), observationDays: fd.opt(f, "observationDays") ? Math.min(90, Math.max(3, fd.int(f, "observationDays"))) : null,
    };
    await db.automationSetting.update({ where: { clientId }, data });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "automation.update", entityType: "AutomationSetting", entityId: before.id, oldValue: before, newValue: data, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "SYSTEM", type: "automation.updated", title: "Automation settings updated", actor: actorOf(ctx) });
    await enqueue("content.plan", { clientId }, { organizationId: ctx.orgId, clientId, label: "Re-plan calendar after settings change", triggeredBy: "HUMAN", priority: 3 });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Automation settings saved." };
  });
}

const CONSENT_KEYS = ["gbpAutoPosting", "aiImages", "positiveReviewReplies", "websiteMetadataChanges", "internalLinking", "blogs", "autoPublishing", "reports", "rankTracking", "gbpProfileEdits"] as const;

export async function updateConsentAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_automations"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const before = await db.clientConsent.findUniqueOrThrow({ where: { clientId } });
    const next = Object.fromEntries(CONSENT_KEYS.map((k) => [k, fd.bool(f, k)])) as Record<(typeof CONSENT_KEYS)[number], boolean>;
    const history = [...((before.history as unknown[]) ?? []), { at: new Date().toISOString(), by: ctx.user.name, changes: CONSENT_KEYS.filter((k) => before[k] !== next[k]).map((k) => ({ k, to: next[k] })) }].slice(-50);
    await db.clientConsent.update({ where: { clientId }, data: { ...next, recordedById: ctx.memberId, recordedAt: new Date(), history: history as Prisma.InputJsonValue } });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "consent.update", oldValue: before, newValue: next, source: "ui" });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Consent recorded." };
  });
}

export async function changePackageAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["edit_client", "manage_automations"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const pkgId = fd.opt(f, "packageId");
    const pkg = pkgId ? await db.servicePackage.findFirstOrThrow({ where: { id: pkgId, organizationId: ctx.orgId } }) : null;
    await db.client.update({ where: { id: clientId }, data: { packageId: pkg?.id ?? null } });
    if (pkg) await db.automationSetting.update({ where: { clientId }, data: packageToSettings(pkg) });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "package.change", newValue: { package: pkg?.name ?? null }, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "CLIENT", type: "package.changed", title: `Package changed to ${pkg?.name ?? "none"} — automations updated`, actor: actorOf(ctx) });
    await enqueue("content.plan", { clientId }, { organizationId: ctx.orgId, clientId, label: "Re-plan calendar after package change", triggeredBy: "HUMAN", priority: 3 });
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Package updated and automations adjusted." };
  });
}

// ───────────────────────── Website / integrations ─────────────────────────

export async function connectWebsiteAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_website"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const url = normalizeUrl(z.string().min(4).parse(fd.str(f, "url")));
    const kind = fd.str(f, "kind") === "WEBSITE_GENERIC" ? "WEBSITE_GENERIC" : "WEBSITE_WORDPRESS";
    const demo = !env.live && fd.bool(f, "demo");
    const secret = kind === "WEBSITE_WORDPRESS" ? fd.str(f, "secret") || randomToken(24) : null;
    const integration = await db.integration.upsert({
      where: { organizationId_clientId_kind: { organizationId: ctx.orgId, clientId, kind } },
      create: { organizationId: ctx.orgId, clientId, kind, mode: demo ? "DEMO" : "LIVE", status: kind === "WEBSITE_GENERIC" || demo ? "CONNECTED" : "PENDING", displayName: url, externalId: url, credentialsEnc: secret ? encryptJson({ siteUrl: url, secret }) : null },
      update: { mode: demo ? "DEMO" : "LIVE", status: kind === "WEBSITE_GENERIC" || demo ? "CONNECTED" : "PENDING", displayName: url, externalId: url, credentialsEnc: secret ? encryptJson({ siteUrl: url, secret }) : null, lastError: null },
    });
    const site = await db.website.upsert({ where: { clientId_url: { clientId, url } }, create: { organizationId: ctx.orgId, clientId, url, platform: kind === "WEBSITE_WORDPRESS" ? "wordpress" : "custom", integrationId: integration.id }, update: { integrationId: integration.id } });
    await db.client.update({ where: { id: clientId }, data: { website: url } });
    if (kind === "WEBSITE_WORDPRESS" && !demo) {
      // Verify the plugin responds to a signed request before marking as connected.
      const { WordPressClient } = await import("@/lib/integrations/wordpress");
      try {
        const status = await new WordPressClient(integration).status();
        await db.integration.update({ where: { id: integration.id }, data: { status: "CONNECTED", lastSyncAt: new Date(), config: status as unknown as Prisma.InputJsonValue } });
        await db.website.update({ where: { id: site.id }, data: { cms: status as unknown as Prisma.InputJsonValue } });
      } catch (e) {
        await db.integration.update({ where: { id: integration.id }, data: { status: "ERROR", lastError: (e as Error).message.slice(0, 300) } });
        revalidatePath(`/clients/${clientId}`, "layout");
        return { ok: false, error: `Saved, but the connector didn't respond: ${(e as Error).message}. Install the plugin and paste the secret into it.` };
      }
    }
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "website.connect", newValue: { url, kind, mode: demo ? "DEMO" : "LIVE" }, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "WEBSITE", type: "website.connected", title: `Website connected: ${url}`, actor: actorOf(ctx) });
    await enqueue("website.crawl", { clientId }, { organizationId: ctx.orgId, clientId, label: "Website audit after connection", triggeredBy: "HUMAN", priority: 2 });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Website connected — first crawl queued." };
  });
}

export async function connectGoogleDataAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_website"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const kind = fd.str(f, "kind") === "GOOGLE_ANALYTICS_4" ? "GOOGLE_ANALYTICS_4" : "GOOGLE_SEARCH_CONSOLE";
    const connId = fd.str(f, "connectionId");
    const conn = await db.googleConnection.findFirstOrThrow({ where: { id: connId, organizationId: ctx.orgId } });
    const externalId = z.string().min(3).parse(fd.str(f, "externalId"));
    await db.integration.upsert({
      where: { organizationId_clientId_kind: { organizationId: ctx.orgId, clientId, kind } },
      create: { organizationId: ctx.orgId, clientId, kind, mode: conn.mode, status: "CONNECTED", externalId, displayName: externalId, googleConnectionId: conn.id },
      update: { mode: conn.mode, status: "CONNECTED", externalId, displayName: externalId, googleConnectionId: conn.id, lastError: null, errorCount: 0 },
    });
    await enqueue(kind === "GOOGLE_ANALYTICS_4" ? "ga4.sync" : "gsc.sync", { clientId }, { organizationId: ctx.orgId, clientId, label: `${kind === "GOOGLE_ANALYTICS_4" ? "GA4" : "Search Console"} first sync`, triggeredBy: "HUMAN", priority: 2 });
    await audit({ organizationId: ctx.orgId, clientId, actor: actorOf(ctx), action: "integration.connect", newValue: { kind, externalId }, source: "ui" });
    await activity({ organizationId: ctx.orgId, clientId, category: "SEO", type: "integration.connected", title: `${kind === "GOOGLE_ANALYTICS_4" ? "Google Analytics 4" : "Search Console"} connected`, actor: actorOf(ctx) });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: "Connected — first sync queued." };
  });
}

export async function disconnectIntegrationAction(integrationId: string) {
  return guarded(["manage_integrations"], async (ctx) => {
    const i = await db.integration.findFirstOrThrow({ where: { id: integrationId, organizationId: ctx.orgId } });
    if (i.clientId) await assertClientAccess(ctx, i.clientId);
    await db.integration.update({ where: { id: i.id }, data: { status: "DISCONNECTED", credentialsEnc: null } });
    await audit({ organizationId: ctx.orgId, clientId: i.clientId, actor: actorOf(ctx), action: "integration.disconnect", entityType: "Integration", entityId: i.id, source: "ui" });
    if (i.clientId) await refreshOnboarding(i.clientId);
    revalidatePath("/integrations");
    if (i.clientId) revalidatePath(`/clients/${i.clientId}`, "layout");
  });
}

// ───────────────────────── Files & media ─────────────────────────

export async function uploadMediaAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_media"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const files = f.getAll("files").filter((x): x is File => x instanceof File && x.size > 0);
    if (!files.length) throw new Error("Choose at least one image");
    const folder = (fd.str(f, "folder") || "SERVICES") as "SERVICES";
    for (const file of files.slice(0, 20)) {
      if (!/^image\//.test(file.type)) throw new Error(`${file.name} is not an image`);
      if (file.size > 15_000_000) throw new Error(`${file.name} is larger than 15MB`);
      const saved = await saveFile(ctx.orgId, clientId, file.name, Buffer.from(await file.arrayBuffer()));
      await db.mediaAsset.create({
        data: { organizationId: ctx.orgId, clientId, folder, url: saved.url, filename: file.name, mimeType: file.type || mimeFor(file.name), sizeBytes: file.size, tags: fd.list(f, "tags"), title: file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "), status: fd.bool(f, "approve") ? "APPROVED" : "PENDING_REVIEW", approvedForGbp: fd.bool(f, "approve"), approvedForBlog: fd.bool(f, "approve"), uploadedById: ctx.memberId },
      });
    }
    await activity({ organizationId: ctx.orgId, clientId, category: "CONTENT", type: "media.uploaded", title: `${files.length} image(s) uploaded to ${folder.toLowerCase().replace("_", " ")}`, actor: actorOf(ctx) });
    await refreshOnboarding(clientId);
    revalidatePath(`/clients/${clientId}`, "layout");
    return { ok: true, message: `${files.length} image(s) uploaded.` };
  });
}

export async function updateMediaAction(mediaId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["manage_media"], async (ctx) => {
    const m = await db.mediaAsset.findFirstOrThrow({ where: { id: mediaId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, m.clientId);
    const status = fd.str(f, "status") as "APPROVED";
    await db.mediaAsset.update({
      where: { id: m.id },
      data: { status: ["PENDING_REVIEW", "APPROVED", "ARCHIVED", "DO_NOT_USE"].includes(status) ? status : m.status, approvedForGbp: fd.bool(f, "approvedForGbp"), approvedForBlog: fd.bool(f, "approvedForBlog"), approvedForAds: fd.bool(f, "approvedForAds"), tags: fd.list(f, "tags"), altText: fd.opt(f, "altText"), folder: (fd.str(f, "folder") || m.folder) as "SERVICES" },
    });
    await audit({ organizationId: ctx.orgId, clientId: m.clientId, actor: actorOf(ctx), action: "media.update", entityType: "MediaAsset", entityId: m.id, source: "ui" });
    revalidatePath(`/clients/${m.clientId}`, "layout");
    return { ok: true, message: "Saved" };
  });
}

export async function uploadFileAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["edit_client"], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const file = f.get("file");
    if (!(file instanceof File) || !file.size) throw new Error("Choose a file");
    if (file.size > 25_000_000) throw new Error("File too large (25MB max)");
    const saved = await saveFile(ctx.orgId, clientId, file.name, Buffer.from(await file.arrayBuffer()));
    await db.fileAsset.create({ data: { organizationId: ctx.orgId, clientId, name: file.name, url: saved.url, mimeType: file.type || mimeFor(file.name), sizeBytes: file.size, category: fd.str(f, "category") || "Document", tags: fd.list(f, "tags"), clientVisible: fd.bool(f, "clientVisible"), uploadedById: ctx.memberId } });
    await activity({ organizationId: ctx.orgId, clientId, category: "CLIENT", type: "file.uploaded", title: `File uploaded: ${file.name}`, actor: actorOf(ctx) });
    revalidatePath(`/clients/${clientId}/files`);
    return { ok: true, message: "File uploaded." };
  });
}

export async function toggleChecklistAction(itemId: string) {
  return guarded(["edit_client"], async (ctx) => {
    const item = await db.onboardingChecklistItem.findFirstOrThrow({ where: { id: itemId, organizationId: ctx.orgId } });
    await assertClientAccess(ctx, item.clientId);
    await db.onboardingChecklistItem.update({ where: { id: item.id }, data: { complete: !item.complete, completedAt: item.complete ? null : new Date(), completedById: ctx.memberId } });
    revalidatePath(`/clients/${item.clientId}`, "layout");
  });
}

// ───────────────────────── Offboarding & assistant ─────────────────────────

export async function offboardAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["delete_client"], async (ctx) => {
    const c = await assertClientAccess(ctx, clientId);
    if (fd.str(f, "confirm") !== c.name) throw new Error("Type the client's exact name to confirm offboarding.");
    await offboardClient(ctx.orgId, clientId, actorOf(ctx), { revokeIntegrations: fd.bool(f, "revoke") });
    revalidatePath("/clients");
    return { ok: true, message: "Offboarding started: automations paused, final report queued, scheduled content removed.", redirect: "/clients" };
  });
}

export async function clientAssistantAction(clientId: string, _p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded([], async (ctx) => {
    await assertClientAccess(ctx, clientId);
    const q = z.string().min(3).max(500).parse(fd.str(f, "q"));
    const r = await askClientAssistant(clientId, q);
    return { ok: true, message: r.data };
  });
}

// ───────────────────────── Bulk operations (spec §58) ─────────────────────────

export async function bulkAction(_p: ActionResult, f: FormData): Promise<ActionResult> {
  return guarded(["bulk_operations"], async (ctx) => {
    const ids = fd.all(f, "ids");
    const op = fd.str(f, "op");
    if (!ids.length) throw new Error("Select at least one client");
    const allowed = await db.client.findMany({ where: { id: { in: ids }, organizationId: ctx.orgId, archivedAt: null }, select: { id: true } });
    for (const { id } of allowed) await assertClientAccess(ctx, id);
    const n = allowed.length;
    const J = (type: string, label: string, payload: Record<string, unknown> = {}) =>
      Promise.all(allowed.map((c) => enqueue(type, { clientId: c.id, ...payload }, { organizationId: ctx.orgId, clientId: c.id, label: `${label} (bulk)`, triggeredBy: "HUMAN", triggeredById: ctx.memberId, priority: 4 })));
    switch (op) {
      case "posts": await J("content.plan", "Bulk generate GBP posts"); await J("content.generate_due", "Generate due content"); break;
      case "audits": await J("website.crawl", "Bulk website audit"); await J("gbp.audit", "Bulk GBP audit"); break;
      case "reports": await J("report.generate", "Bulk report", { type: "MONTHLY_SEO" }); break;
      case "ranks": await J("ranks.check", "Bulk rank check"); break;
      case "pause": await db.client.updateMany({ where: { id: { in: allowed.map((c) => c.id) } }, data: { automationPaused: true } }); break;
      case "resume": await db.client.updateMany({ where: { id: { in: allowed.map((c) => c.id) } }, data: { automationPaused: false } }); break;
      case "level": {
        const level = fd.str(f, "level");
        if (!(LEVELS as readonly string[]).includes(level)) throw new Error("Choose an automation level");
        await db.automationSetting.updateMany({ where: { clientId: { in: allowed.map((c) => c.id) } }, data: { level: level as "ASSIST" } });
        break;
      }
      case "assign_support":
      case "assign_seo": {
        if (!ctx.can("assign_clients")) throw new Error("You can't assign clients");
        const memberId = fd.str(f, "memberId");
        if (!(await db.organizationUser.findFirst({ where: { id: memberId, organizationId: ctx.orgId } }))) throw new Error("Choose a team member");
        const type = op === "assign_support" ? "SUPPORT" : "SEO";
        for (const c of allowed) {
          await db.clientAssignment.deleteMany({ where: { clientId: c.id, type } });
          await db.clientAssignment.create({ data: { organizationId: ctx.orgId, clientId: c.id, memberId, type } });
        }
        break;
      }
      case "onboarding_reminders": {
        for (const c of allowed) await createTask({ organizationId: ctx.orgId, clientId: c.id, title: "Send onboarding reminder to client", category: "Onboarding", priority: "NORMAL", source: "HUMAN", createdById: ctx.memberId, dedupeKey: `bulk-onboard-reminder:${c.id}:${new Date().toISOString().slice(0, 10)}` });
        break;
      }
      case "reconnect_alerts": {
        for (const c of allowed) {
          const broken = await db.gbpLocation.count({ where: { clientId: c.id, account: { connection: { status: { not: "CONNECTED" } } } } });
          if (broken) await createTask({ organizationId: ctx.orgId, clientId: c.id, title: "Reconnect Google Business Profile", category: "Integration", priority: "HIGH", source: "HUMAN", dedupeKey: `reconnect_gbp:${c.id}` });
        }
        break;
      }
      default:
        throw new Error("Unknown bulk operation");
    }
    // Dangerous bulk GBP identity edits are intentionally not offered (spec §58).
    await audit({ organizationId: ctx.orgId, actor: actorOf(ctx), action: `bulk.${op}`, newValue: { clients: allowed.map((c) => c.id) }, source: "ui" });
    revalidatePath("/clients");
    return { ok: true, message: `Bulk "${op.replace(/_/g, " ")}" applied to ${n} client(s).` };
  });
}
