import type { Prisma } from "@prisma/client";
import { db } from "../db";
import { activity, audit, AI_ACTOR, type Actor, SYSTEM_ACTOR } from "../audit";
import { gbpProvider } from "../integrations/gbp";
import { raiseAlert, resolveAlerts } from "../notify";
import { proposeAction } from "../engine/recommendations";
import { loadBrain } from "../ai/brain";
import { suggestGbpDescription } from "../ai/generators";
import { scoreGbp } from "../scoring/gbp";
import { completeTasksByDedupe, createTask } from "../tasks";
import { sha256 } from "../crypto";
import { daysBetween } from "../utils";
import { processNewReview } from "./reviews";
import { refreshOnboarding } from "./onboarding";

/** Pull accounts + locations visible to a Google connection (agency "120 managed locations"). */
export async function syncConnectionLocations(connectionId: string) {
  const conn = await db.googleConnection.findUniqueOrThrow({ where: { id: connectionId } });
  const provider = gbpProvider(conn);
  const accounts = await provider.listAccounts();
  let count = 0;
  for (const a of accounts) {
    const account = await db.gbpAccount.upsert({
      where: { connectionId_googleName: { connectionId, googleName: a.name } },
      create: { organizationId: conn.organizationId, connectionId, googleName: a.name, accountName: a.accountName, type: a.type },
      update: { accountName: a.accountName, type: a.type },
    });
    const locations = await provider.listLocations(a.name);
    for (const l of locations) {
      await db.gbpLocation.upsert({
        where: { accountId_googleName: { accountId: account.id, googleName: l.name } },
        create: {
          organizationId: conn.organizationId,
          accountId: account.id,
          googleName: l.name,
          title: l.title,
          storeCode: l.storeCode,
          address: l.address,
          phone: l.phone,
          websiteUri: l.websiteUri,
          primaryCategory: l.primaryCategory,
          description: l.description,
          latitude: l.latitude,
          longitude: l.longitude,
          verified: l.verified,
          syncStatus: "CONNECTED",
        },
        update: { title: l.title, address: l.address, phone: l.phone, websiteUri: l.websiteUri, primaryCategory: l.primaryCategory, verified: l.verified },
      });
      count++;
    }
  }
  await db.googleConnection.update({ where: { id: connectionId }, data: { lastSyncAt: new Date(), status: "CONNECTED", lastError: null } });
  return { accounts: accounts.length, locations: count };
}

/**
 * Assign a GBP location to a client. Prevents accidental duplicate assignment: the same Google
 * location (even when visible through two Google accounts) can only belong to one client.
 */
export async function assignLocation(args: { organizationId: string; locationId: string; clientId: string; actor: Actor & { memberId?: string } }) {
  const loc = await db.gbpLocation.findFirstOrThrow({ where: { id: args.locationId, organizationId: args.organizationId } });
  const client = await db.client.findFirstOrThrow({ where: { id: args.clientId, organizationId: args.organizationId } });
  if (loc.clientId && loc.clientId !== client.id) throw new Error("This profile is already assigned to another client. Unassign it first.");
  const dup = await db.gbpLocation.findFirst({ where: { organizationId: args.organizationId, googleName: loc.googleName, clientId: { not: null }, NOT: { clientId: client.id } } });
  if (dup) throw new Error("This Google location is already assigned to another client through a different Google account.");
  await db.gbpLocation.update({ where: { id: loc.id }, data: { clientId: client.id, assignedAt: new Date(), assignedById: args.actor.memberId ?? null } });
  await db.client.update({ where: { id: client.id }, data: { hasGbp: true, latitude: client.latitude ?? loc.latitude, longitude: client.longitude ?? loc.longitude } });
  await completeTasksByDedupe(args.organizationId, `onboarding:gbp:${client.id}`);
  await audit({ organizationId: args.organizationId, clientId: client.id, actor: args.actor, action: "gbp.assign", entityType: "GbpLocation", entityId: loc.id, newValue: { location: loc.title, client: client.name }, source: "ui" });
  await activity({ organizationId: args.organizationId, clientId: client.id, category: "GBP", type: "gbp.connected", title: `Google Business Profile connected: ${loc.title}`, actor: args.actor });
  const { enqueue } = await import("../jobs/queue");
  await enqueue("gbp.sync", { locationId: loc.id }, { organizationId: args.organizationId, clientId: client.id, label: `Initial GBP sync: ${loc.title}` });
  await refreshOnboarding(client.id);
  return loc;
}

export async function unassignLocation(args: { organizationId: string; locationId: string; actor: Actor }) {
  const loc = await db.gbpLocation.findFirstOrThrow({ where: { id: args.locationId, organizationId: args.organizationId } });
  await db.gbpLocation.update({ where: { id: loc.id }, data: { clientId: null, assignedAt: null } });
  await audit({ organizationId: args.organizationId, clientId: loc.clientId, actor: args.actor, action: "gbp.unassign", entityType: "GbpLocation", entityId: loc.id, source: "ui" });
}

/** Full sync of one location: profile, services, categories, reviews, posts, metrics, change detection. */
export async function syncLocation(locationId: string) {
  const loc = await db.gbpLocation.findUniqueOrThrow({ where: { id: locationId }, include: { account: { include: { connection: true } } } });
  if (!loc.clientId) return { skipped: "unassigned" };
  const conn = loc.account.connection;
  if (conn.status !== "CONNECTED") {
    await createTask({ organizationId: loc.organizationId, clientId: loc.clientId, title: "Reconnect Google Business Profile", category: "Integration", priority: "URGENT", source: "AUTOMATION", dedupeKey: `reconnect_gbp:${loc.clientId}` });
    throw new Error(`Google connection ${conn.email} is ${conn.status}`);
  }
  const provider = gbpProvider(conn);
  const data = await provider.getLocation(loc.account.googleName, loc.googleName);

  // Unauthorized / Google-made change detection (spec §70): compare with last snapshot, never auto-revert.
  const watched = { title: data.title, address: data.address ?? null, phone: data.phone ?? null, websiteUri: data.websiteUri ?? null, primaryCategory: data.primaryCategory ?? null, description: data.description ?? null, hours: data.hours ?? null };
  const hash = sha256(JSON.stringify(watched));
  const prev = await db.gbpSnapshot.findFirst({ where: { locationId }, orderBy: { createdAt: "desc" } });
  if (prev && prev.hash !== hash) {
    const before = prev.data as Record<string, unknown>;
    const changed = Object.keys(watched).filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify((watched as Record<string, unknown>)[k]));
    const ours = await db.seoAction.findMany({ where: { locationId, createdAt: { gte: prev.createdAt } }, select: { field: true } });
    const ourFields = new Set(ours.map((o) => (o.field === "update_gbp_description" ? "description" : o.field)));
    const unexpected = changed.filter((f) => !ourFields.has(f));
    if (unexpected.length) {
      const identity = unexpected.some((f) => ["title", "address", "phone", "primaryCategory"].includes(f));
      await raiseAlert({
        organizationId: loc.organizationId,
        clientId: loc.clientId,
        severity: identity ? "CRITICAL" : "HIGH",
        type: "gbp_unexpected_change",
        title: `GBP changed outside the platform: ${unexpected.join(", ")}`,
        detail: unexpected.map((f) => `${f}: "${String(before[f] ?? "—").slice(0, 80)}" → "${String((watched as Record<string, unknown>)[f] ?? "—").slice(0, 80)}"`).join("\n"),
        dedupeKey: `gbp_change:${locationId}:${hash}`,
        link: `/clients/${loc.clientId}/gbp`,
      });
    }
  }
  if (!prev || prev.hash !== hash) await db.gbpSnapshot.create({ data: { organizationId: loc.organizationId, clientId: loc.clientId, locationId, data: watched as Prisma.InputJsonValue, hash } });

  await db.gbpLocation.update({
    where: { id: locationId },
    data: {
      title: data.title,
      storeCode: data.storeCode,
      address: data.address,
      phone: data.phone,
      websiteUri: data.websiteUri,
      primaryCategory: data.primaryCategory,
      description: data.description ?? null,
      hours: (data.hours ?? undefined) as Prisma.InputJsonValue | undefined,
      serviceArea: (data.serviceArea ?? undefined) as Prisma.InputJsonValue | undefined,
      attributes: (data.attributes ?? undefined) as Prisma.InputJsonValue | undefined,
      latitude: data.latitude,
      longitude: data.longitude,
      verified: data.verified,
      rawProfile: { photoCount: data.photoCount } as Prisma.InputJsonValue,
      lastSyncAt: new Date(),
      syncStatus: "CONNECTED",
    },
  });
  // Categories & services
  const cats = [...(data.primaryCategory ? [{ name: data.primaryCategory, isPrimary: true }] : []), ...data.additionalCategories.map((name) => ({ name, isPrimary: false }))];
  await db.gbpCategory.deleteMany({ where: { locationId, name: { notIn: cats.map((c) => c.name) } } });
  for (const c of cats) await db.gbpCategory.upsert({ where: { locationId_name: { locationId, name: c.name } }, create: { organizationId: loc.organizationId, clientId: loc.clientId, locationId, ...c }, update: { isPrimary: c.isPrimary } });
  for (const s of data.services) await db.gbpService.upsert({ where: { locationId_name: { locationId, name: s.name } }, create: { organizationId: loc.organizationId, clientId: loc.clientId, locationId, name: s.name, description: s.description }, update: { description: s.description } });

  // Knowledge auto-update: services discovered on GBP flow into the brain (spec §12).
  const k = await db.clientKnowledge.findUnique({ where: { clientId: loc.clientId } });
  if (k) {
    const known = new Set(k.services.map((s) => s.toLowerCase()));
    const fresh = data.services.map((s) => s.name).filter((s) => !known.has(s.toLowerCase()));
    if (fresh.length || !k.gbpSummary) {
      await db.clientKnowledge.update({
        where: { id: k.id },
        data: { services: [...k.services, ...fresh], gbpSummary: `${data.title} — ${data.primaryCategory ?? ""}. ${data.description ?? ""}`.slice(0, 1000), version: { increment: 1 } },
      });
      if (fresh.length) await activity({ organizationId: loc.organizationId, clientId: loc.clientId, category: "AI", type: "knowledge.updated", title: `AI Brain learned ${fresh.length} new service(s) from GBP`, detail: fresh.join(", "), actor: SYSTEM_ACTOR });
    }
  }

  // Reviews
  const reviews = await provider.listReviews(loc.account.googleName, loc.googleName);
  let newReviews = 0;
  for (const r of reviews) {
    const existing = await db.gbpReview.findUnique({ where: { locationId_googleName: { locationId, googleName: r.name } } });
    if (existing) {
      if (r.reply && existing.replyStatus !== "POSTED") await db.gbpReview.update({ where: { id: existing.id }, data: { replyText: r.reply, replyStatus: "POSTED" } });
      continue;
    }
    const created = await db.gbpReview.create({
      data: {
        organizationId: loc.organizationId,
        clientId: loc.clientId,
        locationId,
        googleName: r.name,
        reviewerName: r.reviewerName,
        rating: r.rating,
        comment: r.comment,
        reviewedAt: new Date(r.createTime),
        replyText: r.reply,
        replyStatus: r.reply ? "POSTED" : "UNANSWERED",
      },
    });
    newReviews++;
    // Only run the review workflow for recent unanswered reviews (avoid flooding on first sync).
    if (!r.reply && daysBetween(new Date(r.createTime), new Date()) <= 21) await processNewReview(created.id);
  }

  // Posts
  const posts = await provider.listPosts(loc.account.googleName, loc.googleName);
  for (const p of posts) {
    const existing = await db.gbpPost.findFirst({ where: { locationId, googleName: p.name } });
    if (!existing) await db.gbpPost.create({ data: { organizationId: loc.organizationId, clientId: loc.clientId, locationId, googleName: p.name, summary: p.summary, topicType: p.topicType, state: p.state, publishedAt: new Date(p.createTime), mediaUrl: p.mediaUrl } });
  }

  // Performance metrics (last 30 days)
  const metrics = await provider.getDailyMetrics(loc.googleName, 30);
  for (const m of metrics) {
    const date = new Date(`${m.date}T00:00:00Z`);
    await db.gbpMetric.upsert({
      where: { locationId_date: { locationId, date } },
      create: { organizationId: loc.organizationId, clientId: loc.clientId, locationId, date, impressionsMaps: m.impressionsMaps, impressionsSearch: m.impressionsSearch, calls: m.calls, websiteClicks: m.websiteClicks, directionRequests: m.directionRequests },
      update: { impressionsMaps: m.impressionsMaps, impressionsSearch: m.impressionsSearch, calls: m.calls, websiteClicks: m.websiteClicks, directionRequests: m.directionRequests },
    });
  }
  await resolveAlerts(loc.organizationId, `gbp_sync_failed:${locationId}`);
  return { reviews: reviews.length, newReviews, posts: posts.length, metrics: metrics.length };
}

/** GBP audit: score, issues and structured recommendations routed through the risk engine. */
export async function auditGbp(clientId: string, runId?: string) {
  const client = await db.client.findUniqueOrThrow({ where: { id: clientId }, include: { knowledge: true, locations: { include: { services: true, categories: true } }, websites: { include: { pages: { take: 40 } } } } });
  const audit = await db.seoAudit.create({ data: { organizationId: client.organizationId, clientId, kind: "GBP", status: "RUNNING", startedAt: new Date() } });
  try {
    const brain = await loadBrain(clientId);
    let total = 0;
    let breakdown: Record<string, number> = {};
    const allIssues: { code: string; severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"; title: string; detail?: string }[] = [];
    for (const loc of client.locations) {
      const [reviewAgg, unanswered, lastPost, lastOurPost] = await Promise.all([
        db.gbpReview.aggregate({ where: { locationId: loc.id }, _count: true, _avg: { rating: true } }),
        db.gbpReview.count({ where: { locationId: loc.id, replyStatus: { not: "POSTED" } } }),
        db.gbpPost.findFirst({ where: { locationId: loc.id }, orderBy: { publishedAt: "desc" } }),
        db.contentItem.findFirst({ where: { clientId, type: "GBP_POST", status: "PUBLISHED" }, orderBy: { publishedAt: "desc" } }),
      ]);
      const lastPostAt = [lastPost?.publishedAt, lastOurPost?.publishedAt].filter(Boolean).sort((a, b) => b!.getTime() - a!.getTime())[0] ?? null;
      const primary = brain.services[0]?.toLowerCase() ?? "";
      const pages = client.websites[0]?.pages ?? [];
      const city = client.city ?? "";
      const photoCount = Number((loc.rawProfile as { photoCount?: number } | null)?.photoCount ?? 0);
      const s = scoreGbp({
        title: loc.title,
        description: loc.description,
        primaryCategory: loc.primaryCategory,
        additionalCategories: loc.categories.filter((c) => !c.isPrimary).length,
        services: loc.services.map((x) => x.name),
        knownServices: client.knowledge?.services ?? [],
        hasHours: Boolean(loc.hours && Object.keys(loc.hours as object).length),
        hasPhone: Boolean(loc.phone),
        hasWebsite: Boolean(loc.websiteUri),
        hasAddressOrArea: Boolean(loc.address || loc.serviceArea),
        photoCount,
        recentPhotoCount: Math.min(photoCount, 1),
        reviewCount: reviewAgg._count,
        avgRating: reviewAgg._avg.rating,
        unansweredReviews: unanswered,
        daysSinceLastPost: lastPostAt ? daysBetween(lastPostAt, new Date()) : null,
        websiteMentionsPrimaryService: pages.length ? pages.some((p) => `${p.title ?? ""} ${p.h1 ?? ""}`.toLowerCase().includes(primary.split(" ")[0] ?? primary)) : null,
        descriptionMentionsCity: Boolean(city && loc.description?.toLowerCase().includes(city.toLowerCase().split(",")[0]!)),
        city,
      });
      total += s.score;
      breakdown = s.breakdown;
      allIssues.push(...s.issues);

      // Recommendations
      const missing = s.issues.find((i) => i.code === "missing_services");
      if (missing?.detail) {
        await proposeAction({
          clientId, locationId: loc.id, action: "add_gbp_services", title: `Add ${missing.detail.split(",").length} missing service(s) to GBP`, target: `gbp:${loc.id}:services`,
          reason: "Services offered by the business are not listed on the Google Business Profile.", seoBenefit: "Listing every service helps the profile match more local searches.",
          currentValue: loc.services.map((x) => x.name).join(", ") || "(none)", suggestedValue: missing.detail, confidence: 0.9, severity: missing.severity,
          sourceSignals: ["gbp_incompleteness"], payload: { services: missing.detail.split(",").map((x) => x.trim()) }, expectedImpact: "More relevant service searches",
        });
      }
      if (s.issues.some((i) => i.code === "missing_description" || i.code === "weak_description")) {
        const sug = await suggestGbpDescription(brain, loc.description);
        await proposeAction({
          clientId, locationId: loc.id, action: "update_gbp_description", title: "Improve GBP business description", target: `gbp:${loc.id}:description`,
          reason: sug.reason, seoBenefit: "A complete description with services and service areas improves relevance.", currentValue: loc.description, suggestedValue: sug.description,
          confidence: 0.82, severity: loc.description ? "MEDIUM" : "HIGH", sourceSignals: ["gbp_incompleteness"], expectedImpact: "Better local relevance",
        });
      }
      if (!loc.primaryCategory) {
        await proposeAction({ clientId, locationId: loc.id, action: "manual_task", title: "Set primary GBP category", target: `gbp:${loc.id}:category`, reason: "The profile has no primary category, the strongest local ranking signal.", confidence: 0.95, severity: "CRITICAL", sourceSignals: ["gbp_incompleteness"] });
      }
      if (!loc.hours || !Object.keys(loc.hours as object).length) {
        await proposeAction({ clientId, locationId: loc.id, action: "manual_task", title: "Confirm business hours with the client", target: `gbp:${loc.id}:hours`, reason: "Business hours are missing; confirm the correct hours with the client before publishing.", confidence: 0.9, severity: "HIGH", sourceSignals: ["gbp_incompleteness"] });
      }
    }
    const score = client.locations.length ? Math.round(total / client.locations.length) : 0;
    await db.seoIssue.updateMany({ where: { clientId, category: "gbp", status: "OPEN" }, data: { status: "FIXED", resolvedAt: new Date() } });
    for (const i of allIssues) {
      await db.seoIssue.create({ data: { organizationId: client.organizationId, clientId, auditId: audit.id, code: i.code, category: "gbp", severity: i.severity, title: i.title, detail: i.detail, fingerprint: `gbp:${i.code}` } });
    }
    await db.seoAudit.update({ where: { id: audit.id }, data: { status: "SUCCEEDED", score, breakdown, completedAt: new Date(), summary: `${allIssues.length} GBP issues found` } });
    await db.client.update({ where: { id: clientId }, data: { gbpScore: score } });
    await activity({ organizationId: client.organizationId, clientId, category: "GBP", type: "gbp.audit", title: `GBP audit completed — score ${score}/100`, detail: `${allIssues.length} issues`, actor: AI_ACTOR });
    await refreshOnboarding(clientId);
    return { score, issues: allIssues.length, runId };
  } catch (e) {
    await db.seoAudit.update({ where: { id: audit.id }, data: { status: "FAILED", completedAt: new Date(), summary: (e as Error).message } });
    throw e;
  }
}
