import { db } from "../db";
import { addDays } from "../utils";

export type Brain = Awaited<ReturnType<typeof loadBrain>>;

/**
 * Load the client's "AI Business Brain": structured knowledge + approved AI-context notes +
 * brand kit + content memory. Every AI action is grounded in this context, and only this
 * client's data is ever loaded (tenant isolation for AI).
 */
export async function loadBrain(clientId: string) {
  const client = await db.client.findUniqueOrThrow({
    where: { id: clientId },
    include: { knowledge: true, brandKit: true, automation: true, package: true },
  });
  const [entries, recentContent, reviews, competitors, keywords] = await Promise.all([
    db.knowledgeEntry.findMany({
      where: { clientId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 25,
    }),
    db.contentItem.findMany({
      where: { clientId, createdAt: { gte: addDays(new Date(), -180) }, status: { notIn: ["REJECTED", "IDEA"] } },
      orderBy: { createdAt: "desc" },
      take: 60,
      select: { type: true, title: true, topic: true, servicePromoted: true, cta: true, primaryKeyword: true, imageId: true, publishedAt: true, scheduledFor: true, createdAt: true },
    }),
    db.gbpReview.findMany({ where: { clientId }, orderBy: { reviewedAt: "desc" }, take: 15, select: { rating: true, comment: true, servicesMentioned: true } }),
    db.competitor.findMany({ where: { clientId }, take: 8 }),
    db.keyword.findMany({ where: { clientId }, take: 30, orderBy: { createdAt: "asc" } }),
  ]);
  const k = client.knowledge;
  return {
    client,
    knowledge: k,
    brandKit: client.brandKit,
    settings: client.automation,
    entries,
    recentContent,
    reviews,
    competitors,
    keywords,
    services: k?.services?.length ? k.services : ["General services"],
    prioritized: k?.prioritizeServices ?? [],
    doNotPromote: k?.doNotPromote ?? [],
    wordsToAvoid: k?.wordsToAvoid ?? [],
    city: client.city ?? k?.location ?? "your area",
    industry: (client.industry ?? k?.industry ?? "local business").toLowerCase(),
  };
}

/** Render the brain as a compact system-prompt block. */
export function brainToPrompt(b: Brain): string {
  const k = b.knowledge;
  const lines = [
    `BUSINESS: ${b.client.name} (${b.industry}) — ${b.client.address ?? b.city}`,
    k?.serviceAreas?.length ? `SERVICE AREAS: ${k.serviceAreas.join(", ")}` : "",
    `SERVICES: ${b.services.join(", ")}`,
    k?.products?.length ? `PRODUCTS: ${k.products.join(", ")}` : "",
    k?.usp ? `USP: ${k.usp}` : "",
    k?.targetAudience ? `TARGET AUDIENCE: ${k.targetAudience}` : "",
    `BRAND TONE: ${b.brandKit?.brandTone ?? k?.brandTone ?? "Professional and friendly"}`,
    b.prioritized.length ? `PRIORITIZE THESE SERVICES: ${b.prioritized.join(", ")}` : "",
    b.doNotPromote.length ? `NEVER PROMOTE: ${b.doNotPromote.join(", ")}` : "",
    b.wordsToAvoid.length ? `NEVER USE THESE WORDS: ${b.wordsToAvoid.join(", ")}` : "",
    k?.importantKeywords?.length ? `IMPORTANT KEYWORDS: ${k.importantKeywords.join(", ")}` : "",
    k?.seasonalOffers ? `CURRENT OFFERS: ${k.seasonalOffers}` : "",
    k?.contentPreferences ? `CONTENT PREFERENCES: ${k.contentPreferences}` : "",
    k?.brandGuidelines ? `BRAND GUIDELINES: ${k.brandGuidelines}` : "",
    k?.specialInstructions ? `SPECIAL INSTRUCTIONS: ${k.specialInstructions}` : "",
    b.entries.length ? `RECENT APPROVED CONTEXT (most important first):\n${b.entries.map((e) => `- ${e.content}`).join("\n")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export const SAFETY_RULES = `Hard rules:
- Never invent facts, prices, awards, certifications, staff, guarantees, statistics or customer testimonials.
- Never make legal or medical guarantees or promise specific outcomes.
- Never claim to be "#1", "the best" or "guaranteed" unless the business brain explicitly provides proof.
- Only promote services listed in the business brain and never promote services marked NEVER PROMOTE.
- Write for real local customers in plain English.`;
