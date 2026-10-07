/**
 * Claim-safety checks for AI text. Anything flagged forces human approval regardless of the
 * client's automation level (guardrail: "publishing sensitive claims").
 */
const RISKY_PATTERNS: { re: RegExp; reason: string }[] = [
  { re: /\bguarantee(d|s)?\b/i, reason: "Contains a guarantee claim" },
  { re: /#\s?1\b|\bnumber one\b|\bbest in (town|the city|[a-z]+)\b/i, reason: "Superlative ranking claim" },
  { re: /\b(cure|cures|heal|heals|pain[- ]free|risk[- ]free)\b/i, reason: "Medical/health outcome claim" },
  { re: /\b(lawsuit|legal advice|win your case)\b/i, reason: "Legal claim" },
  { re: /\b\d{1,3}% (off|discount)\b/i, reason: "Specific discount — confirm offer is current" },
  { re: /\$\s?\d/, reason: "Contains a price — confirm with client" },
  { re: /\b(award[- ]winning|certified|licensed and insured|accredited)\b/i, reason: "Credential claim — must be verifiable" },
  { re: /\b(testimonial|our customer [A-Z][a-z]+ said)\b/i, reason: "Possible fabricated testimonial" },
];

export function checkClaims(text: string, opts: { wordsToAvoid?: string[]; doNotPromote?: string[] } = {}) {
  const issues: string[] = [];
  for (const p of RISKY_PATTERNS) if (p.re.test(text)) issues.push(p.reason);
  for (const w of opts.wordsToAvoid ?? []) if (w && new RegExp(`\\b${escapeRe(w)}\\b`, "i").test(text)) issues.push(`Uses avoided word "${w}"`);
  for (const s of opts.doNotPromote ?? []) if (s && new RegExp(escapeRe(s), "i").test(text)) issues.push(`Mentions do-not-promote service "${s}"`);
  return { safe: issues.length === 0, issues };
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function sanitizeForAvoidList(text: string, wordsToAvoid: string[]) {
  let out = text;
  for (const w of wordsToAvoid) if (w) out = out.replace(new RegExp(`\\b${escapeRe(w)}\\b`, "gi"), "");
  return out.replace(/\s{2,}/g, " ").trim();
}
