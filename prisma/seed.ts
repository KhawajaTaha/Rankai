 
import { PrismaClient, type Prisma } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSIONS, SYSTEM_ROLES, type RoleKey } from "../src/lib/permissions";
import { addDays, isoDate, seeded } from "../src/lib/utils";

const db = new PrismaClient();
const PASSWORD = process.env.SEED_PASSWORD ?? "Autopilot!2026";

async function main() {
  const existing = await db.organization.findFirst();
  if (existing && !process.argv.includes("--force")) {
    console.log("Database already seeded (pass --force after a reset to reseed).");
    return;
  }
  console.log("Seeding permission catalog & roles…");
  for (const [key, p] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key, group: p.group, description: p.description }, update: { group: p.group, description: p.description } });
  }
  const org = await db.organization.create({
    data: { name: "Northpeak Local Agency", slug: "northpeak", timezone: "America/Toronto", whiteLabelName: "Northpeak Local", brandColor: "#1f48f5" },
  });
  const roles: Record<string, string> = {};
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    const role = await db.role.create({ data: { organizationId: org.id, key, name: r.name, description: r.description, permissions: r.permissions, isSystem: true, isClientRole: Boolean(r.isClientRole) } });
    roles[key] = role.id;
  }
  await db.slaPolicy.createMany({
    data: [
      { organizationId: org.id, priority: "URGENT", respondWithinHours: 2, resolveWithinHours: 24 },
      { organizationId: org.id, priority: "HIGH", respondWithinHours: 8, resolveWithinHours: 48 },
      { organizationId: org.id, priority: "NORMAL", respondWithinHours: 24, resolveWithinHours: 120 },
      { organizationId: org.id, priority: "LOW", respondWithinHours: 48 },
    ],
  });

  console.log("Seeding team…");
  const hash = await bcrypt.hash(PASSWORD, 12);
  const people: { key: string; name: string; email: string; role: RoleKey; title?: string; superAdmin?: boolean }[] = [
    { key: "owner", name: "Alex Morgan", email: "admin@northpeak.example", role: "agency_admin", title: "Agency Owner", superAdmin: true },
    { key: "seom", name: "Jordan Lee", email: "seo.manager@northpeak.example", role: "seo_manager", title: "SEO Manager" },
    { key: "seo1", name: "Priya Shah", email: "priya@northpeak.example", role: "seo_specialist", title: "SEO Specialist" },
    { key: "content", name: "Sam Rivera", email: "content@northpeak.example", role: "content_manager", title: "Content Manager" },
    { key: "supm", name: "Taylor Brooks", email: "support.manager@northpeak.example", role: "support_manager", title: "Support Manager" },
    { key: "agent1", name: "Maya Chen", email: "maya@northpeak.example", role: "support_agent", title: "Support Agent" },
    { key: "agent2", name: "Daniel Ortiz", email: "daniel@northpeak.example", role: "support_agent", title: "Support Agent" },
    { key: "ro", name: "Robin Avery", email: "readonly@northpeak.example", role: "read_only", title: "Accountant" },
  ];
  const m: Record<string, string> = {};
  for (const p of people) {
    const user = await db.user.create({ data: { email: p.email, name: p.name, passwordHash: hash, isSuperAdmin: Boolean(p.superAdmin) } });
    const mem = await db.organizationUser.create({ data: { organizationId: org.id, userId: user.id, roleId: roles[p.role]!, title: p.title } });
    m[p.key] = mem.id;
  }
  await db.organizationUser.updateMany({ where: { id: { in: [m.agent1!, m.agent2!] } }, data: { managerId: m.supm } });

  console.log("Seeding packages & templates…");
  const pkgs = {
    basic: await db.servicePackage.create({ data: { organizationId: org.id, name: "Local SEO Basic", monthlyPrice: 49900, gbpPostsPerWeek: 1, blogsPerMonth: 0, rankTracking: "WEEKLY", mapGrid: "OFF", reports: "MONTHLY" } }),
    pro: await db.servicePackage.create({ data: { organizationId: org.id, name: "Local SEO Pro", monthlyPrice: 89900, gbpPostsPerWeek: 2, blogsPerMonth: 1, rankTracking: "WEEKLY", mapGrid: "MONTHLY", reports: "MONTHLY" } }),
    web: await db.servicePackage.create({ data: { organizationId: org.id, name: "SEO + Website", monthlyPrice: 129900, gbpPostsPerWeek: 2, blogsPerMonth: 2, rankTracking: "WEEKLY", mapGrid: "WEEKLY", websiteAutomation: true, reports: "BOTH" } }),
    full: await db.servicePackage.create({ data: { organizationId: org.id, name: "Full Growth", monthlyPrice: 199900, gbpPostsPerWeek: 3, blogsPerMonth: 4, rankTracking: "DAILY", mapGrid: "WEEKLY", websiteAutomation: true, reports: "BOTH" } }),
  };
  await db.clientTemplate.createMany({
    data: [
      { organizationId: org.id, name: "Home Services", industry: "Home Services", description: "2 GBP posts/week, 1 blog/month, weekly rank tracking, positive review replies, monthly report", automation: { postsPerWeek: 2, postDays: [1, 4], blogsPerMonth: 1, blogsEnabled: true, rankTracking: "WEEKLY", reviewAutoReply: "AUTO_POSITIVE", autoReply5: true, monthlyReport: true } },
      { organizationId: org.id, name: "Healthcare", industry: "Healthcare", description: "2 GBP posts/week, 2 blogs/month, strict review approval, healthcare-safe content", contentSafety: "healthcare-safe", automation: { postsPerWeek: 2, postDays: [2, 5], blogsPerMonth: 2, blogsEnabled: true, reviewAutoReply: "APPROVAL_ALL", postsRequireApproval: true, blogRequireApproval: true, imageStyle: "Healthcare" } },
      { organizationId: org.id, name: "Auto Services", industry: "Automotive", description: "3 GBP posts/week, local service content, weekly map grid", automation: { postsPerWeek: 3, postDays: [1, 3, 5], mapGrid: "WEEKLY", imageStyle: "Automotive" } },
    ],
  });

  console.log("Seeding agency Google connection (Demo Mode)…");
  const conn = await db.googleConnection.create({ data: { organizationId: org.id, ownerType: "AGENCY", email: "gbp-manager@northpeak.example", mode: "DEMO", status: "CONNECTED", scopes: ["business.manage"], connectedById: m.owner } });

  // Import services lazily so env (DATABASE_URL) is loaded first.
  const { syncConnectionLocations, assignLocation, syncLocation, auditGbp } = await import("../src/lib/services/gbp");
  const { createClientFromWizard, refreshOnboarding } = await import("../src/lib/services/onboarding");
  const { crawlAndAudit, syncSearchConsole, syncGa4 } = await import("../src/lib/services/website");
  const { checkClientRanks, runClientGrid, analyzeCompetitors } = await import("../src/lib/services/rankings");
  const { weeklyStrategy } = await import("../src/lib/services/strategy");
  const { planCalendar, generateContent, publishContent } = await import("../src/lib/services/content");
  const { generateReport } = await import("../src/lib/services/reports");
  const { logCall, addNote, createTicket } = await import("../src/lib/services/support");
  const { updateHealth } = await import("../src/lib/services/watchdog");
  const { encryptJson } = await import("../src/lib/crypto");

  await syncConnectionLocations(conn.id);
  const locations = await db.gbpLocation.findMany({ where: { organizationId: org.id } });
  const loc = (title: string) => locations.find((l) => l.title === title)!;

  const actor = (key: string, roleKey: string, name: string) => ({ type: "HUMAN" as const, id: m[key]!, memberId: m[key]!, roleKey, name, orgId: org.id });

  console.log("Seeding clients via the onboarding wizard…");
  const defs = [
    { name: "Superior Custom Granite", industry: "Countertops", city: "Thunder Bay", services: ["Granite Countertops", "Quartz Countertops", "Kitchen Countertop Installation", "Bathroom Vanities", "Countertop Repair"], pkg: pkgs.web.id, agent: "agent1", seo: "seo1", full: true },
    { name: "Northshore Plumbing & Drain", industry: "Plumbing", city: "Thunder Bay", services: ["Emergency Plumbing", "Drain Cleaning", "Water Heater Installation", "Sump Pump Repair"], pkg: pkgs.pro.id, agent: "agent1", seo: "seo1", full: true },
    { name: "Bright Smile Family Dental", industry: "Dental clinic", city: "Sudbury", services: ["Teeth Cleaning", "Dental Implants", "Teeth Whitening", "Emergency Dentist"], pkg: pkgs.full.id, agent: "agent2", seo: "seo1", full: true },
    { name: "Lakehead Auto Detailing", industry: "Auto detailing", city: "Thunder Bay", services: ["Interior Detailing", "Ceramic Coating", "Paint Correction"], pkg: pkgs.pro.id, agent: "agent2", seo: "seom", full: true },
    { name: "Peak Roofing Solutions", industry: "Roofing", city: "Kenora", services: ["Roof Replacement", "Roof Repair", "Shingle Roofing", "Metal Roofing"], pkg: pkgs.basic.id, agent: "agent1", seo: "seom", full: false, gbpOnly: true },
    { name: "Comfort Air HVAC", industry: "HVAC", city: "Sault Ste. Marie", services: ["Furnace Repair", "AC Installation", "Duct Cleaning"], pkg: pkgs.pro.id, agent: "agent2", seo: "seo1", full: false },
    { name: "Cedar Ridge Electrical", industry: "Electrician", city: "Thunder Bay", services: ["Panel Upgrades", "EV Charger Installation", "Lighting Installation"], pkg: pkgs.basic.id, agent: "agent1", seo: null, full: false, newOnly: true },
  ];
  const created: { id: string; name: string; full: boolean }[] = [];
  for (const d of defs) {
    const slug = d.name.toLowerCase().replace(/[^a-z]+/g, "");
    const c = await createClientFromWizard(
      org.id,
      {
        businessName: d.name,
        contactName: ["Mark Bianchi", "Lisa Ford", "Dr. Anika Rao", "Kevin Tran", "Grace Holt", "Owen Price", "Nina Patel"][created.length]!,
        phone: `(807) 555-0${100 + created.length}`,
        email: `owner@${slug}.example`,
        website: `https://www.${slug}.example`,
        address: `${120 + created.length * 37} Memorial Ave`,
        city: `${d.city}, ON`,
        region: "ON",
        industry: d.industry,
        services: d.services,
        locationsServed: [d.city, "Surrounding area"],
        hasGbp: "yes",
        websitePlatform: "WordPress",
        mainGoal: "More calls and quote requests from Google",
        notes: created.length === 0 ? "Client wants kitchen countertop consultations promoted heavily this month." : undefined,
        packageId: d.pkg,
        supportAgentId: m[d.agent],
        seoSpecialistId: d.seo ? m[d.seo] : null,
      },
      actor(d.agent, "support_agent", people.find((p) => p.key === d.agent)!.name),
    );
    created.push({ id: c.id, name: d.name, full: d.full });
    if ("newOnly" in d && d.newOnly) continue;

    await assignLocation({ organizationId: org.id, locationId: loc(d.name).id, clientId: c.id, actor: actor("owner", "agency_admin", "Alex Morgan") });
    await db.client.update({ where: { id: c.id }, data: { latitude: loc(d.name).latitude, longitude: loc(d.name).longitude } });
    await syncLocation(loc(d.name).id);
    if ("gbpOnly" in d && d.gbpOnly) {
      await auditGbp(c.id);
      continue;
    }
    // Website (demo WordPress connector), GSC & GA4 (demo) integrations.
    const website = await db.website.findFirstOrThrow({ where: { clientId: c.id } });
    const wpInt = await db.integration.create({ data: { organizationId: org.id, clientId: c.id, kind: "WEBSITE_WORDPRESS", mode: "DEMO", status: "CONNECTED", displayName: website.url, externalId: website.url, credentialsEnc: encryptJson({ siteUrl: website.url, secret: "demo" }), lastSyncAt: new Date() } });
    await db.website.update({ where: { id: website.id }, data: { integrationId: wpInt.id, platform: "wordpress", cms: { theme: "Hello Elementor", elementor: true, seoPlugin: "rank_math", plugins: ["elementor", "seo-by-rank-math", "local-seo-autopilot-connector"] } } });
    if (d.full) {
      await db.integration.create({ data: { organizationId: org.id, clientId: c.id, kind: "GOOGLE_SEARCH_CONSOLE", mode: "DEMO", status: "CONNECTED", externalId: `sc-domain:${slug}.example`, displayName: `${slug}.example`, googleConnectionId: conn.id } });
      await db.integration.create({ data: { organizationId: org.id, clientId: c.id, kind: "GOOGLE_ANALYTICS_4", mode: "DEMO", status: "CONNECTED", externalId: "properties/000000", displayName: "Demo GA4 Property", googleConnectionId: conn.id } });
    }
    await db.competitor.createMany({
      data: [
        { organizationId: org.id, clientId: c.id, name: `${d.city} ${d.services[0]!.split(" ")[0]} Pros`, website: `https://${d.city.toLowerCase().replace(/\W/g, "")}pros.example`, gbpCategory: d.industry, services: [...d.services.slice(0, 2), "Emergency Service"] },
        { organizationId: org.id, clientId: c.id, name: `Elite ${d.industry} Co.`, website: "https://elite.example", gbpCategory: d.industry, services: [d.services[0]!, "Emergency Service", "Free Estimates"] },
      ],
    });
    await db.clientConsent.update({ where: { clientId: c.id }, data: { gbpAutoPosting: true, aiImages: true, positiveReviewReplies: true, websiteMetadataChanges: true, internalLinking: true, blogs: true, autoPublishing: d.full, gbpProfileEdits: true } });
    await db.automationSetting.update({ where: { clientId: c.id }, data: { websiteSafeFixes: true, reviewAutoReply: "AUTO_POSITIVE", autoReply5: true, autoReply4: d.full, postsRequireApproval: !d.full, autoPublishPosts: d.full, aiImagesGbp: d.full ? "AUTO_USE" : "REQUIRE_APPROVAL", level: d.full ? "FULL_SAFE_AUTOPILOT" : "APPROVAL_AUTOPILOT", gridSize: 5 } });
    await db.clientBrandKit.update({ where: { clientId: c.id }, data: { primaryColor: ["#0f766e", "#1d4ed8", "#0891b2", "#b91c1c", "#7c3aed", "#ea580c"][created.length % 6]!, designStyle: ["Premium", "Bold", "Clean", "Modern", "Local", "Friendly"][created.length % 6]! } });
    await db.clientKnowledge.update({ where: { clientId: c.id }, data: { usp: `Family-owned ${d.industry.toLowerCase()} specialists serving ${d.city} for over 15 years.`, targetAudience: "Homeowners and small businesses", brandTone: "Professional, warm and local", wordsToAvoid: ["cheap", "guaranteed"], doNotPromote: d.name.includes("Dental") ? ["Teeth Whitening"] : [] } });

    await crawlAndAudit(c.id);
    if (d.full) {
      await syncSearchConsole(c.id);
      await syncGa4(c.id);
    }
    await auditGbp(c.id);
    await analyzeCompetitors(c.id);
  }

  console.log("Seeding rank history, grids, content and support activity…");
  for (const c of created) {
    const kws = await db.keyword.findMany({ where: { clientId: c.id } });
    // 12 weeks of history so trend charts are meaningful (Demo SERP data).
    for (const k of kws) {
      const r = seeded(k.id);
      let pos = 10 + r() * 20;
      for (let w = 12; w >= 1; w--) {
        pos = Math.max(1, pos - r() * 1.6 + 0.4);
        await db.rankHistory.create({ data: { organizationId: org.id, clientId: c.id, keywordId: k.id, position: Math.round(pos), localPosition: Math.max(1, Math.round(pos * 0.6)), checkedAt: addDays(new Date(), -w * 7), source: "DEMO" } });
      }
      await db.keyword.update({ where: { id: k.id }, data: { currentPosition: Math.round(pos), searchVolume: Math.round(40 + r() * 900) } });
    }
    await checkClientRanks(c.id);
    const client = await db.client.findUniqueOrThrow({ where: { id: c.id }, include: { locations: true } });
    if (!client.locations.length) continue;
    // Older grid run for comparison, then current
    await runClientGrid(c.id);
    const runs = await db.localGridRun.findMany({ where: { clientId: c.id } });
    for (const run of runs) await db.localGridRun.create({ data: { ...run, id: undefined, points: (run.points as Prisma.InputJsonValue), avgPosition: (run.avgPosition ?? 8) + 2.4, top3Coverage: Math.max(0, (run.top3Coverage ?? 0.3) - 0.12), shareOfVoice: Math.max(0, (run.shareOfVoice ?? 0.4) - 0.1), createdAt: addDays(new Date(), -30) } });

    // Published history (content memory) + generated upcoming calendar
    const past = [21, 14, 7].map((d) => addDays(new Date(), -d));
    for (const when of past) {
      const item = await db.contentItem.create({ data: { organizationId: org.id, clientId: c.id, locationId: client.locations[0]!.id, type: "GBP_POST", status: "SCHEDULED", title: "post", category: ["Service", "Educational", "Offer"][past.indexOf(when)]!, scheduledFor: when } });
      await generateContent(item.id);
      const fresh = await db.contentItem.findUniqueOrThrow({ where: { id: item.id } });
      await db.contentItem.update({ where: { id: item.id }, data: { status: "SCHEDULED" } });
      await db.approval.deleteMany({ where: { contentItemId: item.id } });
      await publishContent(item.id);
      await db.contentItem.update({ where: { id: item.id }, data: { publishedAt: when, createdAt: when } });
      void fresh;
    }
    if (c.full) {
      await planCalendar(c.id, 4);
      const ideas = await db.contentItem.findMany({ where: { clientId: c.id, status: "IDEA" }, orderBy: { scheduledFor: "asc" }, take: 3 });
      for (const i of ideas) await generateContent(i.id);
      await weeklyStrategy(c.id);
    }
  }

  // Support activity
  const [granite, plumbing, dental, auto] = created;
  const a1 = actor("agent1", "support_agent", "Maya Chen");
  const a2 = actor("agent2", "support_agent", "Daniel Ortiz");
  await logCall(a1, { clientId: granite!.id, contactName: "Mark Bianchi", occurredAt: addDays(new Date(), -2), direction: "OUTGOING", outcome: "ANSWERED", durationMin: 14, purpose: "Monthly check-in", discussion: "Mark is happy with the new posts. Wants more focus on quartz this fall.", result: "Agreed to promote quartz consultations", followUpRequired: true, followUpDate: addDays(new Date(), 3), tags: ["SEO", "GBP"] });
  await logCall(a1, { clientId: plumbing!.id, contactName: "Lisa Ford", occurredAt: addDays(new Date(), -5), direction: "INCOMING", outcome: "ANSWERED", durationMin: 6, purpose: "Billing question", discussion: "Asked about the invoice for last month.", result: "Resolved", followUpRequired: true, followUpDate: addDays(new Date(), -1), tags: ["Billing"] });
  await logCall(a2, { clientId: dental!.id, occurredAt: addDays(new Date(), -1), direction: "OUTGOING", outcome: "VOICEMAIL", purpose: "Approval reminder", followUpRequired: true, followUpDate: new Date(), tags: ["Content"] });
  await addNote(a1, { clientId: granite!.id, body: "Promote quartz countertop consultations through October — client has a fall promotion running.", category: "Campaign", priority: "HIGH", visibility: "INTERNAL", useAsAiContext: true, pinned: true });
  await addNote(a2, { clientId: auto!.id, body: "Owner prefers no prices in posts. @Priya please keep ceramic coating content educational.", category: "Content Preferences", priority: "NORMAL", visibility: "INTERNAL", useAsAiContext: true });
  await createTicket({ organizationId: org.id, clientId: plumbing!.id, type: "WEBSITE_CHANGE", subject: "Update emergency phone number on website", description: "Please add our new after-hours line (807) 555-0199 to the header.", priority: "HIGH", requestedBy: "Lisa Ford", actor: { type: "CLIENT", name: "Lisa Ford" } });
  await createTicket({ organizationId: org.id, clientId: dental!.id, type: "CONTENT_REQUEST", subject: "Post about new evening hours", description: "We are now open until 8pm on Thursdays.", priority: "NORMAL", requestedBy: "Dr. Anika Rao", actor: { type: "CLIENT", name: "Dr. Anika Rao" } });

  console.log("Seeding client portal users…");
  const portalHash = hash;
  const owner = await db.user.create({ data: { email: "owner@superiorcustomgranite.example", name: "Mark Bianchi", passwordHash: portalHash } });
  await db.organizationUser.create({ data: { organizationId: org.id, userId: owner.id, roleId: roles.client_owner!, clientId: granite!.id, title: "Owner" } });
  const staff = await db.user.create({ data: { email: "staff@superiorcustomgranite.example", name: "Jess Bianchi", passwordHash: portalHash } });
  await db.organizationUser.create({ data: { organizationId: org.id, userId: staff.id, roleId: roles.client_staff!, clientId: granite!.id, title: "Office Manager" } });

  console.log("Generating reports & health scores…");
  for (const c of created) {
    await refreshOnboarding(c.id);
    await updateHealth(c.id);
    if (c.full) {
      const report = await generateReport(c.id, "MONTHLY_SEO");
      await db.report.update({ where: { id: report.id }, data: { createdAt: addDays(new Date(), -3) } });
    }
  }
  // Some automation history for the command center
  await db.automationRun.create({ data: { organizationId: org.id, clientId: auto!.id, type: "content.publish", label: "Publish: Ceramic coating care tips", status: "NEEDS_HUMAN", attempts: 3, lastError: "Google API 503 on /v4/accounts/…/localPosts: backend error", startedAt: addDays(new Date(), -1), completedAt: addDays(new Date(), -1), createdAt: addDays(new Date(), -1) } });
  console.log(`\nDone. Sign in with any seeded account, password: ${PASSWORD}`);
  console.log("  admin@northpeak.example (Agency Admin)\n  maya@northpeak.example (Support Agent)\n  support.manager@northpeak.example (Support Manager)\n  owner@superiorcustomgranite.example (Client Owner)");
  void isoDate;
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
