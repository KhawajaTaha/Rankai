import { z } from "zod";
import { generateStructured, generateText } from "./client";
import { brainToPrompt, SAFETY_RULES, type Brain } from "./brain";
import { checkClaims, sanitizeForAvoidList } from "./safety";
import { seeded, slugify, topicSimilarity, titleCase } from "../utils";

// ───────────────────────── Content memory ─────────────────────────

/** Pick the next service to promote: prioritized first, then least recently promoted. */
export function pickService(b: Brain, preferred?: string | null): string {
  const allowed = b.services.filter((s) => !b.doNotPromote.some((d) => d.toLowerCase() === s.toLowerCase()));
  if (preferred && allowed.includes(preferred)) return preferred;
  const pool = b.prioritized.filter((p) => allowed.includes(p)).length ? b.prioritized.filter((p) => allowed.includes(p)) : allowed;
  const lastUsed = new Map<string, number>();
  for (const c of b.recentContent) {
    if (c.servicePromoted && !lastUsed.has(c.servicePromoted)) lastUsed.set(c.servicePromoted, c.createdAt.getTime());
  }
  return [...(pool.length ? pool : allowed)].sort((a, b2) => (lastUsed.get(a) ?? 0) - (lastUsed.get(b2) ?? 0))[0] ?? allowed[0] ?? "our services";
}

export function memoryPrompt(b: Brain, type: string) {
  const recent = b.recentContent.filter((c) => c.type === type).slice(0, 25);
  if (!recent.length) return "No previous content of this type.";
  return `PREVIOUS ${type} CONTENT — do NOT repeat these topics, angles, titles or CTAs:\n${recent
    .map((c) => `- "${c.title}" | service: ${c.servicePromoted ?? "-"} | cta: ${c.cta ?? "-"}`)
    .join("\n")}`;
}

export function isRepetitive(b: Brain, type: string, title: string, threshold = 0.6) {
  return b.recentContent.some((c) => c.type === type && topicSimilarity(c.title, title) >= threshold);
}

// ───────────────────────── GBP posts ─────────────────────────

export const GbpPostSchema = z.object({
  title: z.string().describe("Internal title / topic of the post"),
  body: z.string().describe("Post text, 80-250 words, no hashtags spam, ends with a soft CTA"),
  cta: z.enum(["CALL", "BOOK", "LEARN_MORE", "ORDER", "SIGN_UP", "GET_OFFER"]),
  servicePromoted: z.string(),
  keywords: z.array(z.string()).max(6),
  imageConcept: z.string().describe("A contextual, non-misleading promotional image concept for this post"),
});
export type GbpPostDraft = z.infer<typeof GbpPostSchema> & { safetyIssues: string[]; mode: "LIVE" | "DEMO" };

export async function generateGbpPost(b: Brain, opts: { category: string; service?: string | null; attempt?: number }): Promise<GbpPostDraft> {
  const service = pickService(b, opts.service);
  const result = await generateStructured({
    system: `You write Google Business Profile posts for a local business.\n${SAFETY_RULES}\n\n${brainToPrompt(b)}`,
    prompt: `Write one ${opts.category} GBP post promoting "${service}" for customers in ${b.city}.
Preferred CTA: ${b.settings?.ctaPreference ?? "CALL"}.
${memoryPrompt(b, "GBP_POST")}
The imageConcept must describe a contextual promotional scene (tools, environment, product visualisation) — never fake staff, fake awards, fake certificates, fake before/after results, fake storefronts or testimonials.`,
    schema: GbpPostSchema,
    effort: "low",
    fallback: () => demoGbpPost(b, opts.category, service, opts.attempt ?? 0),
  });
  const data = result.data;
  data.body = sanitizeForAvoidList(data.body, b.wordsToAvoid);
  const safety = checkClaims(`${data.title} ${data.body}`, { wordsToAvoid: b.wordsToAvoid, doNotPromote: b.doNotPromote });
  return { ...data, safetyIssues: safety.issues, mode: result.mode };
}

const POST_ANGLES: Record<string, ((s: string, city: string, n: string) => { title: string; body: string })[]> = {
  Service: [
    (s, c, n) => ({ title: `${titleCase(s)} in ${c}`, body: `Looking for reliable ${s.toLowerCase()} in ${c}? The team at ${n} handles every project with care, clear communication and attention to detail from the first visit to the final walkthrough. We'll listen to what you need, explain your options in plain language and get the job done right. Reach out today to talk through your project.` }),
    (s, c, n) => ({ title: `How ${n} approaches ${s.toLowerCase()}`, body: `Every ${s.toLowerCase()} project at ${n} starts with understanding your space and your goals. From planning and measurements to the finishing touches, we keep you informed at each step so there are no surprises. Homeowners and businesses across ${c} trust us for dependable, tidy work. Get in touch to schedule a conversation.` }),
    (s, c, n) => ({ title: `${titleCase(s)}: what to expect`, body: `Thinking about ${s.toLowerCase()}? Here's what working with ${n} looks like: a quick consultation, a clear plan, scheduled work that respects your time, and a final check together when we're done. Serving ${c} and surrounding areas. Contact us to get started.` }),
  ],
  Educational: [
    (s, c) => ({ title: `3 questions to ask before ${s.toLowerCase()}`, body: `Before you start any ${s.toLowerCase()} project, ask: 1) What's the timeline and what could affect it? 2) What maintenance will this need over the years? 3) What's included in the quote? Clear answers up front save time and stress later. Have questions about your own project in ${c}? We're happy to help.` }),
    (s) => ({ title: `Common mistakes with ${s.toLowerCase()}`, body: `The most common issues we see with ${s.toLowerCase()} come from rushed planning and skipped preparation. Taking time to measure carefully, choose suitable materials and plan for everyday use makes a big difference to how long the result lasts. If you're planning a project, talk to us first — a short conversation can prevent costly do-overs.` }),
    (s, c) => ({ title: `Caring for your ${s.toLowerCase()} through the seasons`, body: `${c} weather changes a lot through the year, and that affects ${s.toLowerCase()}. A little seasonal attention — regular cleaning, quick inspections and addressing small issues early — keeps everything looking and working its best. Not sure what your situation needs? Reach out and we'll point you in the right direction.` }),
  ],
  Offer: [
    (s, c, n) => ({ title: `Book a ${s.toLowerCase()} consultation`, body: `Planning ${s.toLowerCase()} this season? ${n} is booking consultations now for customers in ${c}. We'll review your space, talk through options and give you a clear, written quote. Spots fill quickly — contact us to reserve a time that works for you.` }),
    (s, c) => ({ title: `Now scheduling ${s.toLowerCase()} projects`, body: `Our calendar is open for new ${s.toLowerCase()} projects in ${c}. If you've been putting off a project, now is a great time to get it on the schedule. Call or message us and we'll find a time to talk.` }),
  ],
  Seasonal: [
    (s, c) => ({ title: `Getting ready for the season: ${s.toLowerCase()}`, body: `As the season changes in ${c}, it's a good moment to think about ${s.toLowerCase()}. Planning ahead means better scheduling options and less rush. Let us know what you have in mind and we'll help you plan the right timing.` }),
    (s, c, n) => ({ title: `${n}: seasonal ${s.toLowerCase()} check-in`, body: `A quick seasonal reminder from ${n}: if ${s.toLowerCase()} is on your list this year, reach out early. We're helping customers across ${c} plan their projects now so everything is ready when you need it.` }),
  ],
};

function demoGbpPost(b: Brain, category: string, service: string, attempt: number) {
  const angles = POST_ANGLES[category] ?? POST_ANGLES.Service;
  const rand = seeded(`${b.client.id}:${category}:${service}:${b.recentContent.length}:${attempt}`);
  // Content memory: try each angle, skip ones too similar to previous posts.
  const order = angles.map((_, i) => (i + Math.floor(rand() * angles.length)) % angles.length);
  let chosen = angles[order[0]!]!(service, b.city, b.client.name);
  for (const i of order) {
    const cand = angles[i]!(service, b.city, b.client.name);
    if (!isRepetitive(b, "GBP_POST", cand.title)) {
      chosen = cand;
      break;
    }
  }
  const ctas = ["CALL", "BOOK", "LEARN_MORE"] as const;
  return {
    title: chosen.title,
    body: chosen.body,
    cta: category === "Offer" ? ("BOOK" as const) : (b.settings?.ctaPreference as (typeof ctas)[number]) && ctas.includes(b.settings?.ctaPreference as (typeof ctas)[number]) ? (b.settings!.ctaPreference as (typeof ctas)[number]) : ctas[Math.floor(rand() * ctas.length)]!,
    servicePromoted: service,
    keywords: [`${service.toLowerCase()} ${b.city.toLowerCase()}`, service.toLowerCase()],
    imageConcept: imageConceptFor(b.industry, service),
  };
}

export function imageConceptFor(industry: string, service: string) {
  const i = industry.toLowerCase();
  if (/plumb/.test(i)) return `Professional plumbing tools and a clean modern sink installation related to ${service}`;
  if (/dent|health|clinic|medical/.test(i)) return `Bright, clean modern dental/clinic treatment room concept related to ${service}, no people`;
  if (/granite|counter|kitchen|stone/.test(i)) return `Premium kitchen design visualisation featuring stone countertops related to ${service}`;
  if (/auto|detail|car/.test(i)) return `Clean vehicle detailing environment with polished car surface related to ${service}`;
  if (/roof/.test(i)) return `Neat residential roofline and roofing materials concept related to ${service}`;
  if (/hvac|heat|cool/.test(i)) return `Modern HVAC unit and service tools concept related to ${service}`;
  if (/law|legal/.test(i)) return `Professional office desk with documents concept, no people, related to ${service}`;
  return `Clean, professional concept image illustrating ${service} in a local setting`;
}

// ───────────────────────── Blogs ─────────────────────────

export const BlogSchema = z.object({
  topic: z.string(),
  primaryKeyword: z.string(),
  secondaryKeywords: z.array(z.string()).max(8),
  searchIntent: z.enum(["informational", "commercial", "transactional", "local"]),
  slug: z.string(),
  seoTitle: z.string().describe("<= 60 characters"),
  metaDescription: z.string().describe("<= 155 characters"),
  h1: z.string(),
  outline: z.array(z.object({ h2: z.string(), h3: z.array(z.string()) })),
  contentMarkdown: z.string().describe("Full article in Markdown using the outline"),
  faqs: z.array(z.object({ question: z.string(), answer: z.string() })).max(6),
  internalLinks: z.array(z.object({ anchor: z.string(), url: z.string() })).max(6),
  externalReferences: z.array(z.object({ title: z.string(), url: z.string() })).max(4),
  cta: z.string(),
  featuredImage: z.object({ concept: z.string(), altText: z.string(), title: z.string(), caption: z.string() }),
});
export type BlogDraft = z.infer<typeof BlogSchema> & { schema: Record<string, unknown>[]; safetyIssues: string[]; mode: "LIVE" | "DEMO"; wordCount: number };

export async function generateBlog(
  b: Brain,
  opts: { topic?: string | null; service?: string | null; pages?: { url: string; title: string | null }[]; minWords?: number; opportunity?: string | null },
): Promise<BlogDraft> {
  const service = pickService(b, opts.service);
  const minWords = opts.minWords ?? b.settings?.blogMinWords ?? 900;
  const pages = (opts.pages ?? []).slice(0, 30);
  const result = await generateStructured({
    system: `You are an expert local SEO content writer.\n${SAFETY_RULES}\n\n${brainToPrompt(b)}`,
    prompt: `Write a helpful, original local SEO blog article of at least ${minWords} words.
Topic: ${opts.topic ?? `choose the best topic for "${service}" in ${b.city}`}
${opts.opportunity ? `Search opportunity to target: ${opts.opportunity}` : ""}
Only use internal link URLs from this list of existing pages:
${pages.map((p) => `- ${p.url} (${p.title ?? ""})`).join("\n") || "- (no pages known; leave internalLinks empty)"}
${memoryPrompt(b, "BLOG")}
External references must be reputable, real organisations' homepages only (never invent deep links).`,
    schema: BlogSchema,
    maxTokens: 32000,
    effort: "medium",
    fallback: () => demoBlog(b, service, opts.topic ?? null, pages, minWords),
  });
  const d = result.data;
  d.slug = slugify(d.slug || d.h1);
  const safety = checkClaims(d.contentMarkdown, { wordsToAvoid: b.wordsToAvoid, doNotPromote: b.doNotPromote });
  const wordCount = d.contentMarkdown.split(/\s+/).filter(Boolean).length;
  const schema = [
    { "@context": "https://schema.org", "@type": "Article", headline: d.h1, description: d.metaDescription, author: { "@type": "Organization", name: b.client.name }, publisher: { "@type": "Organization", name: b.client.name } },
    ...(d.faqs.length
      ? [{ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: d.faqs.map((f) => ({ "@type": "Question", name: f.question, acceptedAnswer: { "@type": "Answer", text: f.answer } })) }]
      : []),
  ];
  return { ...d, schema, safetyIssues: safety.issues, mode: result.mode, wordCount };
}

function demoBlog(b: Brain, service: string, topic: string | null, pages: { url: string; title: string | null }[], minWords: number) {
  const city = b.city;
  const s = service.toLowerCase();
  const candidates = [
    `The complete guide to ${s} in ${city}`,
    `How to plan your ${s} project in ${city}`,
    `${titleCase(s)} costs and options explained for ${city} homeowners`,
    `Questions to ask before hiring for ${s} in ${city}`,
    `Maintaining your ${s}: a seasonal checklist for ${city}`,
  ];
  const h1 = topic ?? candidates.find((c) => !isRepetitive(b, "BLOG", c)) ?? candidates[0]!;
  const outline = [
    { h2: `Why ${s} matters for ${city} properties`, h3: ["Local conditions to consider", "Long-term value"] },
    { h2: `Planning your ${s} project`, h3: ["Setting goals and budget", "Choosing materials and options", "Timelines"] },
    { h2: `What the process looks like with ${b.client.name}`, h3: ["Consultation", "Preparation", "Completion and walkthrough"] },
    { h2: `Caring for the results`, h3: ["Routine care", "When to call a professional"] },
  ];
  const para = (topicLine: string) =>
    `${topicLine} Every property is different, so the right approach depends on how you use the space, your timeline and your budget. Taking time to plan carefully, ask questions and understand the trade-offs between options usually leads to a better result that lasts. In ${city}, seasonal weather and local building styles are worth factoring in early, because they affect both scheduling and material choices. A good provider will explain each step clearly and give you a written plan before work begins.`;
  let md = `# ${h1}\n\n${para(`If you're considering ${s}, this guide walks through what to know before you start.`)}\n\n`;
  for (const sec of outline) {
    md += `## ${sec.h2}\n\n${para(`${sec.h2}.`)}\n\n`;
    for (const h3 of sec.h3) md += `### ${h3}\n\n${para(`${h3} is an important part of ${s}.`)}\n\n`;
  }
  const faqs = [
    { question: `How long does ${s} usually take?`, answer: `It depends on the size and scope of the project. After a consultation, ${b.client.name} provides a clear timeline before work starts.` },
    { question: `Do you serve areas outside ${city}?`, answer: `${b.knowledge?.serviceAreas?.length ? `Yes — we serve ${b.knowledge.serviceAreas.join(", ")}.` : `Contact us to confirm whether we serve your area.`}` },
    { question: `How do I get started?`, answer: `Reach out to schedule a consultation. We'll discuss your goals and next steps.` },
  ];
  md += `## Frequently asked questions\n\n${faqs.map((f) => `### ${f.question}\n\n${f.answer}`).join("\n\n")}\n\n## Ready to get started?\n\nContact ${b.client.name} to talk about your ${s} project in ${city}.\n`;
  while (md.split(/\s+/).length < minWords) md = md.replace("## Frequently asked questions", `${para(`More about ${s} in ${city}.`)}\n\n## Frequently asked questions`);
  const links = pages.filter((p) => p.url).slice(0, 3).map((p) => ({ anchor: p.title ?? s, url: p.url }));
  return {
    topic: h1,
    primaryKeyword: `${s} ${city.toLowerCase()}`,
    secondaryKeywords: [s, `${s} near me`, `${s} cost`, `${s} ideas`],
    searchIntent: "local" as const,
    slug: slugify(h1),
    seoTitle: h1.length > 60 ? `${titleCase(s)} in ${city} | Guide` : h1,
    metaDescription: `Planning ${s} in ${city}? Learn how to plan, what to expect and how to care for the results — from ${b.client.name}.`.slice(0, 155),
    h1,
    outline,
    contentMarkdown: md,
    faqs,
    internalLinks: links,
    externalReferences: [],
    cta: `Call ${b.client.name} to book a consultation`,
    featuredImage: {
      concept: imageConceptFor(b.industry, service),
      altText: `${titleCase(s)} project in ${city}`,
      title: `${titleCase(s)} in ${city}`,
      caption: `${titleCase(s)} — ${b.client.name}`,
    },
  };
}

// ───────────────────────── Reviews ─────────────────────────

export function analyzeReview(b: Brain, rating: number, text: string | null) {
  const t = (text ?? "").toLowerCase();
  const neg = /(rude|late|never|terrible|awful|worst|disappoint|scam|refund|broken|poor|unprofessional|waste)/.test(t);
  const sentiment = rating >= 4 && !neg ? "POSITIVE" : rating <= 2 || neg ? "NEGATIVE" : "NEUTRAL";
  const servicesMentioned = b.services.filter((s) => {
    const words = s.toLowerCase().split(/\s+/).filter((w) => w.length > 3);
    return words.some((w) => t.includes(w));
  });
  return { sentiment: sentiment as "POSITIVE" | "NEUTRAL" | "NEGATIVE", servicesMentioned };
}

const ReplySchema = z.object({ reply: z.string() });

export async function generateReviewReply(
  b: Brain,
  review: { reviewerName: string; rating: number; comment: string | null; servicesMentioned: string[] },
  previousReplies: string[],
) {
  const first = review.reviewerName.split(" ")[0] ?? "there";
  const result = await generateStructured({
    system: `You reply to Google reviews on behalf of a local business owner. Personal, warm, specific, 2-4 sentences.
Never disclose private customer details, never admit legal liability, never offer refunds or compensation unless instructed, and never argue.
For negative reviews: acknowledge, apologise for the experience, invite them to contact the business directly to resolve it.
${brainToPrompt(b)}`,
    prompt: `Review by ${review.reviewerName} (${review.rating}★): "${review.comment ?? "(no text)"}"
Services mentioned: ${review.servicesMentioned.join(", ") || "none"}
Avoid repeating the wording of these recent replies:\n${previousReplies.slice(0, 8).map((r) => `- ${r}`).join("\n") || "- none"}`,
    schema: ReplySchema,
    effort: "low",
    fallback: () => ({ reply: demoReply(b, first, review, previousReplies.length) }),
  });
  return { reply: sanitizeForAvoidList(result.data.reply, b.wordsToAvoid), mode: result.mode };
}

function demoReply(b: Brain, first: string, r: { rating: number; comment: string | null; servicesMentioned: string[] }, n: number) {
  const svc = r.servicesMentioned[0]?.toLowerCase();
  const pick = <T,>(arr: T[]) => arr[n % arr.length]!;
  if (r.rating >= 4) {
    return pick([
      `Thank you so much, ${first}! We're thrilled you're happy${svc ? ` with your ${svc}` : ""}. It was a pleasure working with you, and we appreciate you taking the time to share your experience.`,
      `${first}, this made our day — thank you! ${svc ? `We loved helping with your ${svc} project. ` : ""}We're grateful for your trust and hope to see you again.`,
      `Hi ${first}, thanks for the wonderful review! Our team takes real pride in their work${svc ? ` on every ${svc} job` : ""}, and feedback like yours means a lot.`,
      `We really appreciate the kind words, ${first}. ${svc ? `Glad the ${svc} turned out just the way you wanted. ` : ""}Thanks for choosing ${b.client.name}!`,
    ]);
  }
  if (r.rating === 3) {
    return `Thank you for the feedback, ${first}. We're glad parts of your experience went well, and we'd love to hear how we could have done better. Please reach out to us directly so we can make it right.`;
  }
  return `Hi ${first}, we're sorry to hear about your experience — this isn't the standard we aim for. We'd like to understand what happened and make things right. Please contact ${b.client.name} directly${b.client.phone ? ` at ${b.client.phone}` : ""} so we can talk.`;
}

// ───────────────────────── GBP description / fields ─────────────────────────

const DescriptionSchema = z.object({ description: z.string().describe("<= 750 characters"), reason: z.string() });

export async function suggestGbpDescription(b: Brain, current: string | null) {
  const result = await generateStructured({
    system: `You optimise Google Business Profile descriptions. Max 750 characters. No URLs, no promotional prices, no superlative claims.\n${SAFETY_RULES}\n${brainToPrompt(b)}`,
    prompt: `Current description: "${current ?? "(empty)"}"\nWrite an improved description that naturally mentions the primary services and service areas.`,
    schema: DescriptionSchema,
    effort: "low",
    fallback: () => {
      const areas = b.knowledge?.serviceAreas?.length ? b.knowledge.serviceAreas.slice(0, 4).join(", ") : b.city;
      const svcs = b.services.slice(0, 4).join(", ").toLowerCase();
      const usp = b.knowledge?.usp ? ` ${b.knowledge.usp.replace(/\.$/, "")}.` : "";
      return {
        description: `${b.client.name} provides ${svcs} for homes and businesses in ${areas}.${usp} From the first consultation to the final walkthrough, our team focuses on clear communication, careful workmanship and results that last. Contact us to discuss your project.`.slice(0, 750),
        reason: current ? "Current description under-uses primary services and service areas." : "Profile has no description.",
      };
    },
  });
  return { ...result.data, mode: result.mode };
}

// ───────────────────────── Strategy, reports, assistants ─────────────────────────

export const StrategySchema = z.object({
  summary: z.string(),
  priorities: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        expectedImpact: z.string(),
        risk: z.enum(["LOW", "MEDIUM", "HIGH"]),
        mode: z.enum(["AUTO", "APPROVAL", "MANUAL"]),
        action: z.string().describe("machine action key if applicable, else 'manual'"),
      }),
    )
    .min(1)
    .max(5),
});

export async function generateWeeklyStrategy(b: Brain, signals: Record<string, unknown>, fallback: () => z.infer<typeof StrategySchema>) {
  return generateStructured({
    system: `You are a senior local SEO strategist. Produce this week's top 5 priorities for one client, ordered by expected impact.
Respect change cooldowns: do not propose rewriting assets that were changed recently unless critical.
${SAFETY_RULES}\n${brainToPrompt(b)}`,
    prompt: `Signals for this week (JSON):\n${JSON.stringify(signals, null, 1).slice(0, 12000)}`,
    schema: StrategySchema,
    effort: "medium",
    fallback,
    rulesFallbackOk: true,
  });
}

export async function generateReportSummary(clientName: string, facts: string[], fallback: () => string) {
  return generateText({
    system: `You write plain-English SEO report summaries for small business owners. No jargon (avoid words like SERP, CTR, canonical, schema). 3-5 sentences. Only use the facts given; never invent numbers.`,
    prompt: `Client: ${clientName}\nFacts:\n${facts.map((f) => `- ${f}`).join("\n")}`,
    fallback,
  });
}

export async function answerWithContext(args: { system: string; question: string; context: string; fallback: () => string }) {
  return generateText({
    system: `${args.system}\nAnswer only from the provided data. If the data does not contain the answer, say so. Be concise and actionable; use short bullet lists when helpful.`,
    prompt: `DATA:\n${args.context}\n\nQUESTION: ${args.question}`,
    fallback: args.fallback,
    effort: "low",
  });
}
