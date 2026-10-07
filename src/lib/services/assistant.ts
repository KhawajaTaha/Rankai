import { db } from "../db";
import { brainToPrompt, loadBrain } from "../ai/brain";
import { answerWithContext } from "../ai/generators";
import { addDays, startOfWeek } from "../utils";
import { scanClients } from "./watchdog";
import { searchOpportunities } from "./website";

/**
 * Client AI assistant (spec §74). Context is assembled from THIS client's authorised data only;
 * the caller must already have verified access to clientId.
 */
export async function askClientAssistant(clientId: string, question: string) {
  const brain = await loadBrain(clientId);
  const since = addDays(new Date(), -30);
  const [strategy, actions, notes, calls, keywords, recs, content, reviews, opps] = await Promise.all([
    db.weeklyStrategy.findFirst({ where: { clientId }, orderBy: { weekOf: "desc" } }),
    db.seoAction.findMany({ where: { clientId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.supportNote.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.supportCall.findMany({ where: { clientId }, orderBy: { occurredAt: "desc" }, take: 8 }),
    db.keyword.findMany({ where: { clientId } }),
    db.aiRecommendation.findMany({ where: { clientId, status: { in: ["PROPOSED", "NEEDS_APPROVAL", "SCHEDULED"] } }, orderBy: { confidence: "desc" }, take: 10 }),
    db.contentItem.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 15, select: { type: true, title: true, status: true, servicePromoted: true, scheduledFor: true, publishedAt: true } }),
    db.gbpReview.findMany({ where: { clientId }, orderBy: { reviewedAt: "desc" }, take: 10, select: { rating: true, comment: true, replyStatus: true } }),
    searchOpportunities(clientId),
  ]);
  const drops = keywords.filter((k) => k.currentPosition && k.previousPosition && k.currentPosition > k.previousPosition);
  const context = [
    brainToPrompt(brain),
    `SCORES: GBP ${brain.client.gbpScore ?? "—"}, Website SEO ${brain.client.seoScore ?? "—"}, Health ${brain.client.healthScore ?? "—"}`,
    strategy ? `THIS WEEK'S PLAN: ${strategy.summary}\n${(strategy.priorities as { rank: number; title: string; why: string }[]).map((p) => `${p.rank}. ${p.title} — ${p.why}`).join("\n")}` : "No weekly plan yet.",
    `WORK COMPLETED (30d):\n${actions.map((a) => `- ${a.createdAt.toISOString().slice(0, 10)} ${a.field} on ${a.target}${a.measuredOutcome ? ` (${a.measuredOutcome})` : ""}`).join("\n") || "- none"}`,
    `KEYWORDS:\n${keywords.map((k) => `- ${k.phrase}: ${k.currentPosition ?? "—"} (prev ${k.previousPosition ?? "—"})`).join("\n")}`,
    `OPEN RECOMMENDATIONS:\n${recs.map((r) => `- ${r.title} [${r.status}, ${(r.confidence * 100).toFixed(0)}%]: ${r.reason}`).join("\n") || "- none"}`,
    `RECENT SUPPORT NOTES:\n${notes.map((n) => `- ${n.createdAt.toISOString().slice(0, 10)} [${n.category}] ${n.body}`).join("\n") || "- none"}`,
    `RECENT CALLS:\n${calls.map((c) => `- ${c.occurredAt.toISOString().slice(0, 10)} ${c.direction} ${c.outcome}: ${c.purpose ?? ""} — ${c.discussion ?? ""}`).join("\n") || "- none"}`,
    `CONTENT:\n${content.map((c) => `- ${c.type} "${c.title}" ${c.status}${c.servicePromoted ? ` (${c.servicePromoted})` : ""}`).join("\n")}`,
    `REVIEWS:\n${reviews.map((r) => `- ${r.rating}★ ${r.replyStatus}: ${(r.comment ?? "").slice(0, 100)}`).join("\n")}`,
    `SEARCH OPPORTUNITIES:\n${opps.slice(0, 8).map((o) => `- ${o.type}: "${o.query}" pos ${o.position.toFixed(1)}, ${o.impressions} impressions`).join("\n") || "- none"}`,
  ].join("\n\n");

  return answerWithContext({
    system: `You are the internal SEO assistant for the agency team working on ${brain.client.name}.`,
    question,
    context,
    fallback: () => {
      const q = question.toLowerCase();
      if (/focus|this week|priorit/.test(q)) return strategy ? `**This week's focus**\n\n${strategy.summary}\n\n${(strategy.priorities as { rank: number; title: string; why: string }[]).map((p) => `${p.rank}. **${p.title}** — ${p.why}`).join("\n")}` : `No weekly plan yet. Top open recommendations:\n${recs.slice(0, 5).map((r) => `- ${r.title}`).join("\n") || "- none"}`;
      if (/rank|drop/.test(q)) return drops.length ? `**${drops.length} keyword(s) declined:**\n${drops.map((k) => `- "${k.phrase}": ${k.previousPosition} → ${k.currentPosition}`).join("\n")}\n\nLikely causes to check: recent page changes (${actions.length} in 30d), competitor activity, and GBP posting cadence.` : "No keyword drops detected in the latest check.";
      if (/support|discuss|call|note/.test(q)) return `**Recent support activity**\n${calls.slice(0, 4).map((c) => `- ${c.occurredAt.toDateString()}: ${c.purpose ?? "Call"} — ${c.discussion ?? c.outcome}`).join("\n") || "- No calls"}\n${notes.slice(0, 4).map((n) => `- Note (${n.category}): ${n.body.slice(0, 140)}`).join("\n")}`;
      if (/content plan|next month|calendar/.test(q)) return `**Suggested content plan**\n${brain.services.slice(0, 4).map((s, i) => `- Week ${i + 1}: GBP service post on ${s}; educational post answering a common ${s.toLowerCase()} question`).join("\n")}\n- Blog: ${opps[0] ? `target "${opps[0].query}"` : `guide to ${brain.services[0]}`}`;
      if (/promot|service/.test(q)) {
        const counts = new Map(brain.services.map((s) => [s, content.filter((c) => c.servicePromoted === s).length]));
        return `**Services needing more promotion** (fewest recent pieces):\n${[...counts.entries()].sort((a, b) => a[1] - b[1]).slice(0, 4).map(([s, n]) => `- ${s}: ${n} recent item(s)`).join("\n")}${brain.prioritized.length ? `\n\nPriority services from the brain: ${brain.prioritized.join(", ")}` : ""}`;
      }
      if (/complet|done|work/.test(q)) return `**SEO work completed in the last 30 days (${actions.length})**\n${actions.slice(0, 12).map((a) => `- ${a.createdAt.toDateString()}: ${a.field.replace(/_/g, " ")} — ${a.target}`).join("\n") || "- none yet"}`;
      return `Here's a snapshot for ${brain.client.name}: GBP score ${brain.client.gbpScore ?? "—"}, website SEO ${brain.client.seoScore ?? "—"}, ${recs.length} open recommendations, ${keywords.length} tracked keywords. Ask about this week's focus, ranking changes, support history, content plans or completed work.`;
    },
  });
}

/** Agency-wide assistant (spec §75): answers across clients the user is allowed to see. */
export async function askAgencyAssistant(organizationId: string, clientIds: string[] | null, question: string) {
  const where = { organizationId, archivedAt: null, ...(clientIds ? { id: { in: clientIds } } : {}) };
  const clients = await db.client.findMany({ where, select: { id: true, name: true, status: true, onboardingStage: true, healthScore: true, supportHealth: true } });
  const ids = clients.map((c) => c.id);
  const weekStart = startOfWeek();
  const [atRisk, postsThisWeek, keywordDrops, overdueByAgent] = await Promise.all([
    scanClients(organizationId, { clientIds: ids }),
    db.contentItem.groupBy({ by: ["clientId"], where: { clientId: { in: ids }, type: "GBP_POST", status: "PUBLISHED", publishedAt: { gte: weekStart } }, _count: true }),
    db.keyword.findMany({ where: { clientId: { in: ids }, currentPosition: { not: null }, previousPosition: { not: null } }, select: { clientId: true, phrase: true, currentPosition: true, previousPosition: true } }),
    db.followUp.groupBy({ by: ["assignedToId"], where: { organizationId, clientId: { in: ids }, completedAt: null, dueAt: { lt: new Date() } }, _count: true }),
  ]);
  const members = await db.organizationUser.findMany({ where: { organizationId }, include: { user: { select: { name: true } } } });
  const name = (id: string | null) => members.find((m) => m.id === id)?.user.name ?? "Unassigned";
  const cname = (id: string) => clients.find((c) => c.id === id)?.name ?? id;
  const posted = new Set(postsThisWeek.map((p) => p.clientId));
  const drops = keywordDrops.filter((k) => k.currentPosition! - k.previousPosition! >= 3);
  const context = [
    `CLIENTS (${clients.length}):\n${clients.map((c) => `- ${c.name}: ${c.status}, stage ${c.onboardingStage}, health ${c.healthScore ?? "—"}, support ${c.supportHealth}`).join("\n")}`,
    `AT RISK:\n${atRisk.map((r) => `- ${r.name}: ${r.flags.map((f) => f.label).join("; ")}`).join("\n") || "- none"}`,
    `NO GBP POST THIS WEEK: ${clients.filter((c) => !posted.has(c.id) && c.status === "ACTIVE").map((c) => c.name).join(", ") || "none"}`,
    `RANKING DROPS (3+):\n${drops.map((d) => `- ${cname(d.clientId)}: "${d.phrase}" ${d.previousPosition} → ${d.currentPosition}`).join("\n") || "- none"}`,
    `OVERDUE FOLLOW-UPS BY AGENT:\n${overdueByAgent.map((o) => `- ${name(o.assignedToId)}: ${o._count}`).join("\n") || "- none"}`,
  ].join("\n\n");
  return answerWithContext({
    system: "You are the agency operations assistant. Help admins find which clients and staff need attention.",
    question,
    context,
    fallback: () => {
      const q = question.toLowerCase();
      if (/attention|risk|critical/.test(q)) return atRisk.length ? `**${atRisk.length} client(s) need attention**\n${atRisk.slice(0, 15).map((r) => `- **${r.name}** — ${r.flags.map((f) => f.label).join("; ")}`).join("\n")}` : "No clients are currently flagged as at risk.";
      if (/no gbp post|no post|posts this week/.test(q)) {
        const list = clients.filter((c) => !posted.has(c.id) && c.status === "ACTIVE");
        return list.length ? `**Active clients with no GBP post this week (${list.length})**\n${list.map((c) => `- ${c.name}`).join("\n")}` : "Every active client has a GBP post this week.";
      }
      if (/rank/.test(q)) return drops.length ? `**Ranking drops**\n${drops.map((d) => `- ${cname(d.clientId)}: "${d.phrase}" ${d.previousPosition} → ${d.currentPosition}`).join("\n")}` : "No significant ranking drops in the latest checks.";
      if (/follow|agent|overdue/.test(q)) return overdueByAgent.length ? `**Overdue follow-ups by agent**\n${overdueByAgent.map((o) => `- ${name(o.assignedToId)}: ${o._count}`).join("\n")}` : "No overdue follow-ups.";
      if (/onboard/.test(q)) {
        const list = clients.filter((c) => c.status === "ONBOARDING");
        return list.length ? `**Clients not fully onboarded (${list.length})**\n${list.map((c) => `- ${c.name}: ${c.onboardingStage.replace(/_/g, " ").toLowerCase()}`).join("\n")}` : "All clients are fully onboarded.";
      }
      return `You have ${clients.length} clients; ${atRisk.length} need attention. Try: "Which clients need attention?", "Show clients with no GBP posts this week", "Which clients have ranking drops?", "Which support agents have overdue follow-ups?", "Which clients are not fully onboarded?" or "Generate tasks for all critical clients".`;
    },
  });
}
