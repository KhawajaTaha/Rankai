import type { OnboardingStage, Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, audit, type Actor } from "../audit";
import { enqueue } from "../jobs/queue";
import { completeTasksByDedupe, createTask } from "../tasks";
import { addHours, slugify } from "../utils";

export const CHECKLIST: { key: string; label: string }[] = [
  { key: "logo", label: "Logo" },
  { key: "business_description", label: "Business Description" },
  { key: "service_list", label: "Service List" },
  { key: "business_address", label: "Business Address" },
  { key: "phone", label: "Phone" },
  { key: "website_access", label: "Website Access" },
  { key: "gbp_access", label: "GBP Access" },
  { key: "gsc_access", label: "GSC Access" },
  { key: "ga4_access", label: "GA4 Access" },
  { key: "brand_colors", label: "Brand Colors" },
  { key: "photos", label: "Photos" },
  { key: "target_locations", label: "Target Locations" },
  { key: "main_keywords", label: "Main Keywords" },
  { key: "competitors", label: "Competitors" },
];

export const STAGES: { stage: OnboardingStage; label: string }[] = [
  { stage: "NEW_CLIENT", label: "New Client" },
  { stage: "INFORMATION_REQUIRED", label: "Information Required" },
  { stage: "GBP_CONNECTION_PENDING", label: "GBP Connection Pending" },
  { stage: "WEBSITE_CONNECTION_PENDING", label: "Website Connection Pending" },
  { stage: "GSC_CONNECTION_PENDING", label: "GSC Connection Pending" },
  { stage: "GA4_CONNECTION_PENDING", label: "GA4 Connection Pending" },
  { stage: "INITIAL_AUDIT_RUNNING", label: "Initial Audit Running" },
  { stage: "RECOMMENDATIONS_GENERATED", label: "Recommendations Generated" },
  { stage: "AWAITING_APPROVAL", label: "Awaiting Approval" },
  { stage: "OPTIMIZATION_STARTED", label: "Optimization Started" },
  { stage: "FULLY_ACTIVE", label: "Fully Active" },
];

export interface WizardInput {
  businessName: string;
  contactName: string;
  phone?: string;
  email?: string;
  website?: string;
  address?: string;
  city?: string;
  region?: string;
  industry?: string;
  services: string[];
  locationsServed: string[];
  hasGbp: "yes" | "no" | "unsure";
  websitePlatform?: string;
  mainGoal?: string;
  notes?: string;
  packageId?: string | null;
  templateId?: string | null;
  supportAgentId?: string | null;
  seoSpecialistId?: string | null;
}

/** Template / package → automation settings & consent defaults. */
async function automationDefaults(orgId: string, packageId?: string | null, templateId?: string | null) {
  const out: Partial<Prisma.AutomationSettingCreateWithoutClientInput> = {};
  if (packageId) {
    const p = await db.servicePackage.findFirst({ where: { id: packageId, organizationId: orgId } });
    if (p) Object.assign(out, packageToSettings(p));
  }
  if (templateId) {
    const t = await db.clientTemplate.findFirst({ where: { id: templateId, organizationId: orgId } });
    if (t) Object.assign(out, t.automation as object);
  }
  return out;
}

export function packageToSettings(p: { gbpPostsPerWeek: number; blogsPerMonth: number; rankTracking: string; mapGrid: string; websiteAutomation: boolean; reports: string; reviewAutomation: boolean }) {
  const days = [[], [2], [1, 4], [1, 3, 5], [1, 2, 4, 5], [1, 2, 3, 4, 5]][Math.min(5, p.gbpPostsPerWeek)] ?? [1, 4];
  return {
    gbpPostingEnabled: p.gbpPostsPerWeek > 0,
    postsPerWeek: p.gbpPostsPerWeek,
    postDays: days,
    blogsEnabled: p.blogsPerMonth > 0,
    blogsPerMonth: p.blogsPerMonth,
    rankTracking: p.rankTracking,
    mapGrid: p.mapGrid,
    websiteSafeFixes: p.websiteAutomation,
    weeklyReport: p.reports === "WEEKLY" || p.reports === "BOTH",
    monthlyReport: p.reports === "MONTHLY" || p.reports === "BOTH",
    reviewAutoReply: p.reviewAutomation ? ("AUTO_POSITIVE" as const) : ("APPROVAL_ALL" as const),
  };
}

/**
 * Guided onboarding (spec §5): creates the client profile, knowledge brain, brand kit, consent,
 * automation settings, onboarding checklist + tasks, SEO campaign seed (keywords), support
 * assignment and the initial baseline jobs — in one transaction.
 */
export async function createClientFromWizard(orgId: string, input: WizardInput, actor: Actor & { memberId: string; roleKey: string }) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
  const baseSlug = slugify(input.businessName) || "client";
  let slug = baseSlug;
  for (let i = 2; await db.client.findUnique({ where: { organizationId_slug: { organizationId: orgId, slug } } }); i++) slug = `${baseSlug}-${i}`;
  const defaults = await automationDefaults(orgId, input.packageId, input.templateId);
  const website = input.website ? normalizeUrl(input.website) : null;
  const city = input.city?.trim() || input.locationsServed[0] || null;
  const cityName = city?.split(",")[0]!.trim().toLowerCase() ?? null;

  const client = await db.$transaction(async (tx) => {
    const c = await tx.client.create({
      data: {
        organizationId: orgId,
        name: input.businessName.trim(),
        slug,
        phone: input.phone,
        email: input.email,
        website,
        address: input.address,
        city,
        region: input.region,
        industry: input.industry,
        mainGoal: input.mainGoal,
        websitePlatform: input.websitePlatform,
        hasGbp: input.hasGbp === "yes" ? true : input.hasGbp === "no" ? false : null,
        packageId: input.packageId || null,
        templateId: input.templateId || null,
        createdById: actor.memberId,
        contacts: { create: { organizationId: orgId, name: input.contactName, email: input.email, phone: input.phone, isPrimary: true, receivesReports: Boolean(input.email) } },
        brandKit: { create: { organizationId: orgId } },
        knowledge: {
          create: {
            organizationId: orgId,
            businessName: input.businessName.trim(),
            industry: input.industry,
            location: [input.address, city].filter(Boolean).join(", ") || null,
            serviceAreas: input.locationsServed,
            services: input.services,
            prioritizeServices: input.services.slice(0, 2),
            importantKeywords: input.services.slice(0, 5).map((s) => `${s.toLowerCase()}${cityName ? ` ${cityName}` : ""}`),
          },
        },
        consent: { create: { organizationId: orgId, recordedById: actor.memberId, reports: true, rankTracking: true } },
        automation: { create: { organizationId: orgId, level: "APPROVAL_AUTOPILOT", reportRecipients: input.email ? [input.email] : [], ...defaults } },
        checklist: { create: CHECKLIST.map((c, i) => ({ organizationId: orgId, key: c.key, label: c.label, sortOrder: i })) },
      },
    });
    // The creating support agent becomes the assigned support agent unless someone else was chosen.
    const supportId = input.supportAgentId || (["support_agent", "support_manager"].includes(actor.roleKey) ? actor.memberId : null);
    if (supportId) await tx.clientAssignment.create({ data: { organizationId: orgId, clientId: c.id, memberId: supportId, type: "SUPPORT" } });
    if (input.seoSpecialistId) await tx.clientAssignment.create({ data: { organizationId: orgId, clientId: c.id, memberId: input.seoSpecialistId, type: "SEO" } });
    if (website) await tx.website.create({ data: { organizationId: orgId, clientId: c.id, url: website, platform: input.websitePlatform?.toLowerCase() || null } });
    for (const s of input.services.slice(0, 10)) {
      const phrase = `${s.toLowerCase()}${cityName ? ` ${cityName}` : ""}`;
      await tx.keyword.create({ data: { organizationId: orgId, clientId: c.id, phrase, group: "SERVICE", location: city } });
    }
    if (input.notes?.trim()) {
      await tx.supportNote.create({ data: { organizationId: orgId, clientId: c.id, body: input.notes.trim(), category: "Onboarding", createdById: actor.memberId, useAsAiContext: true, pinned: true } });
      await tx.knowledgeEntry.create({ data: { organizationId: orgId, clientId: c.id, source: "support_note", content: input.notes.trim(), createdById: actor.memberId } });
    }
    return c;
  });

  await audit({ organizationId: orgId, clientId: client.id, actor, action: "client.create", entityType: "Client", entityId: client.id, newValue: input, source: "ui" });
  await activity({ organizationId: orgId, clientId: client.id, category: "CLIENT", type: "client.created", title: `Client onboarded by ${actor.name ?? "staff"}`, actor });
  await refreshOnboarding(client.id, { slaHours: org.onboardingSlaHours });
  await enqueue("report.generate", { clientId: client.id, type: "WEEKLY_SUMMARY", initial: true }, { organizationId: orgId, clientId: client.id, label: "Initial baseline report", runAt: addHours(new Date(), 0.05) });
  await enqueue("ranks.check", { clientId: client.id }, { organizationId: orgId, clientId: client.id, label: "Initial keyword baseline" });
  return client;
}

export function normalizeUrl(u: string) {
  const s = u.trim();
  const withProto = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try {
    const url = new URL(withProto);
    return `${url.protocol}//${url.host}/`;
  } catch {
    return withProto;
  }
}

/**
 * Recompute onboarding stage, auto-complete checklist items that can be derived, and create any
 * missing onboarding tasks (idempotent, due within the agency's onboarding SLA). Returns the
 * single next recommended action so the UI can always answer "what do I do next?".
 */
export async function refreshOnboarding(clientId: string, opts: { slaHours?: number } = {}) {
  const c = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { knowledge: true, brandKit: true, locations: true, websites: true, integrations: true, checklist: true, competitors: { take: 1 }, keywords: { take: 1 }, media: { where: { status: "APPROVED" }, take: 1 }, organization: true },
  });
  const sla = opts.slaHours ?? c.organization.onboardingSlaHours;
  const due = addHours(c.createdAt, sla);
  const hasIntegration = (k: string) => c.integrations.some((i) => i.kind === k && i.status === "CONNECTED");
  const websiteConnected = hasIntegration("WEBSITE_WORDPRESS") || hasIntegration("WEBSITE_GENERIC");
  const derived: Record<string, boolean> = {
    logo: Boolean(c.logoUrl || c.brandKit?.logoUrl),
    business_description: Boolean(c.knowledge?.usp || c.knowledge?.websiteSummary || c.locations.some((l) => l.description)),
    service_list: (c.knowledge?.services.length ?? 0) > 0,
    business_address: Boolean(c.address),
    phone: Boolean(c.phone),
    website_access: websiteConnected,
    gbp_access: c.locations.length > 0,
    gsc_access: hasIntegration("GOOGLE_SEARCH_CONSOLE"),
    ga4_access: hasIntegration("GOOGLE_ANALYTICS_4"),
    brand_colors: Boolean(c.brandKit && c.brandKit.updatedAt.getTime() - c.createdAt.getTime() > 5_000),
    photos: c.media.length > 0,
    target_locations: (c.knowledge?.serviceAreas.length ?? 0) > 0,
    main_keywords: c.keywords.length > 0,
    competitors: c.competitors.length > 0,
  };
  for (const item of c.checklist) {
    if (!item.complete && derived[item.key]) await db.onboardingChecklistItem.update({ where: { id: item.id }, data: { complete: true, completedAt: new Date() } });
  }

  const missingInfo = !c.phone || !c.address || !(c.knowledge?.services.length);
  const needsGbp = c.hasGbp !== false && c.locations.length === 0;
  const needsWebsite = Boolean(c.website) && !websiteConnected;
  const needsGsc = Boolean(c.website) && !hasIntegration("GOOGLE_SEARCH_CONSOLE");
  const needsGa4 = Boolean(c.website) && !hasIntegration("GOOGLE_ANALYTICS_4");

  const tasks: { key: string; when: boolean; title: string; category: string; description: string }[] = [
    { key: "info", when: missingInfo, title: "Complete business information", category: "Onboarding", description: "Phone, address and service list are needed before optimisation can start." },
    { key: "gbp", when: needsGbp, title: "Connect Google Business Profile", category: "Onboarding", description: "Ask the client to connect via the portal, or assign the profile from the agency Google account (Settings → Google Connections)." },
    { key: "website", when: needsWebsite, title: "Connect website", category: "Onboarding", description: "Install the Local SEO Autopilot Connector plugin (WordPress) or add the site as a generic website." },
    { key: "gsc", when: needsGsc, title: "Connect Google Search Console", category: "Onboarding", description: "Grant Search Console access and select the property." },
    { key: "ga4", when: needsGa4, title: "Connect Google Analytics 4", category: "Onboarding", description: "Grant GA4 access and select the property." },
    { key: "logo", when: !derived.logo, title: "Collect client logo", category: "Onboarding", description: "Upload the logo to the Media Library (Logo folder) or Brand Kit." },
  ];
  for (const t of tasks) {
    const dedupeKey = `onboarding:${t.key}:${clientId}`;
    if (t.when) await createTask({ organizationId: c.organizationId, clientId, title: t.title, description: t.description, category: t.category, priority: t.key === "gbp" ? "HIGH" : "NORMAL", dueAt: due, source: "ONBOARDING", dedupeKey, notifyAssignee: false });
    else await completeTasksByDedupe(c.organizationId, dedupeKey);
  }

  const [audits, pendingApprovals, executed, recs] = await Promise.all([
    db.seoAudit.findMany({ where: { clientId }, select: { kind: true, status: true } }),
    db.approval.count({ where: { clientId, status: "PENDING" } }),
    db.seoAction.count({ where: { clientId } }),
    db.aiRecommendation.count({ where: { clientId } }),
  ]);
  const auditsDone = (kind: string) => audits.some((a) => a.kind === kind && a.status === "SUCCEEDED");
  const auditsRunning = audits.some((a) => ["QUEUED", "RUNNING", "RETRYING"].includes(a.status));
  const gbpAuditNeeded = c.locations.length > 0 && !auditsDone("GBP");
  const webAuditNeeded = Boolean(c.website) && !auditsDone("WEBSITE");

  let stage: OnboardingStage;
  if (missingInfo) stage = "INFORMATION_REQUIRED";
  else if (needsGbp) stage = "GBP_CONNECTION_PENDING";
  else if (needsWebsite) stage = "WEBSITE_CONNECTION_PENDING";
  else if (needsGsc) stage = "GSC_CONNECTION_PENDING";
  else if (needsGa4) stage = "GA4_CONNECTION_PENDING";
  else if (auditsRunning || gbpAuditNeeded || webAuditNeeded) stage = "INITIAL_AUDIT_RUNNING";
  else if (pendingApprovals > 0 && executed === 0) stage = "AWAITING_APPROVAL";
  else if (executed === 0) stage = recs > 0 ? "RECOMMENDATIONS_GENERATED" : "INITIAL_AUDIT_RUNNING";
  else if (executed < 3) stage = "OPTIMIZATION_STARTED";
  else stage = "FULLY_ACTIVE";
  if (c.onboardingStage === "NEW_CLIENT" && stage === "INFORMATION_REQUIRED" && Date.now() - c.createdAt.getTime() < 60_000) stage = "NEW_CLIENT";

  // Kick initial audits once integrations are in place.
  if (gbpAuditNeeded && !audits.some((a) => a.kind === "GBP")) await enqueue("gbp.audit", { clientId }, { organizationId: c.organizationId, clientId, label: "Initial GBP audit", dedupeKey: `initial-gbp-audit:${clientId}` });
  if (webAuditNeeded && !audits.some((a) => a.kind === "WEBSITE")) await enqueue("website.crawl", { clientId }, { organizationId: c.organizationId, clientId, label: "Initial website audit", dedupeKey: `initial-web-audit:${clientId}` });

  const data: Prisma.ClientUpdateInput = { onboardingStage: stage };
  if (stage === "FULLY_ACTIVE" && c.status === "ONBOARDING") data.status = "ACTIVE";
  if (stage !== c.onboardingStage) {
    await activity({ organizationId: c.organizationId, clientId, category: "CLIENT", type: "onboarding.stage", title: `Onboarding stage: ${STAGES.find((s) => s.stage === stage)?.label}`, actor: { type: "SYSTEM", name: "System" } });
  }
  await db.client.update({ where: { id: clientId }, data });
  if (data.status) {
    const { updateSupportHealth } = await import("./support");
    await updateSupportHealth(clientId);
  }
  return { stage, next: nextAction({ missingInfo, needsGbp, needsWebsite, needsGsc, needsGa4, auditsRunning, pendingApprovals, clientId }) };
}

export function nextAction(s: { missingInfo: boolean; needsGbp: boolean; needsWebsite: boolean; needsGsc: boolean; needsGa4: boolean; auditsRunning: boolean; pendingApprovals: number; clientId: string }) {
  if (s.missingInfo) return { label: "Complete business information", href: `/clients/${s.clientId}/settings`, cta: "Add details" };
  if (s.needsGbp) return { label: "Connect Google Business Profile", href: `/clients/${s.clientId}/gbp`, cta: "Connect Now" };
  if (s.needsWebsite) return { label: "Connect the website", href: `/clients/${s.clientId}/website`, cta: "Connect Website" };
  if (s.needsGsc) return { label: "Connect Search Console", href: `/clients/${s.clientId}/website`, cta: "Connect GSC" };
  if (s.needsGa4) return { label: "Connect Google Analytics 4", href: `/clients/${s.clientId}/website`, cta: "Connect GA4" };
  if (s.auditsRunning) return { label: "Initial audits are running", href: `/clients/${s.clientId}`, cta: "View progress" };
  if (s.pendingApprovals) return { label: `${s.pendingApprovals} recommendation${s.pendingApprovals > 1 ? "s" : ""} awaiting approval`, href: `/approvals?client=${s.clientId}`, cta: "Review now" };
  return { label: "Autopilot is running", href: `/clients/${s.clientId}/automations`, cta: "View automations" };
}

export function onboardingProgress(stage: OnboardingStage) {
  const idx = STAGES.findIndex((s) => s.stage === stage);
  return Math.round((idx / (STAGES.length - 1)) * 100);
}
