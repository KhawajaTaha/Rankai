/**
 * AI image safety: the generator must never produce misleading business imagery.
 * Prompts are screened and rewritten; concepts that imply fabricated facts are refused.
 */
const FORBIDDEN: { re: RegExp; reason: string }[] = [
  { re: /certificat|diploma|licen[cs]e document|accreditation/i, reason: "Fake certificates" },
  { re: /\baward|trophy|winner badge|best of/i, reason: "Fake awards" },
  { re: /before\s*(and|&|\/)\s*after|transformation result/i, reason: "Fake before/after results" },
  { re: /\b(our|the) (staff|team|employees|technician|dentist|doctor|owner)\b|\bteam photo\b|\bportrait of\b/i, reason: "Fake staff representation" },
  { re: /storefront|our (office|building|shop|location)\b|exterior of (the|our)/i, reason: "Fake physical location" },
  { re: /testimonial|customer quote|review card|5[- ]star rating graphic/i, reason: "Fake testimonial" },
  { re: /\b(guarantee|clinically proven|cures?)\b/i, reason: "False product claim" },
];

export function screenImagePrompt(concept: string) {
  const issues = FORBIDDEN.filter((f) => f.re.test(concept)).map((f) => f.reason);
  return { allowed: issues.length === 0, issues };
}

export function buildImagePrompt(args: {
  concept: string;
  industry: string;
  style: string;
  brandColors: string[];
  addText: boolean;
}) {
  return [
    `${args.style} contextual promotional image for a local ${args.industry} business.`,
    `Scene: ${args.concept}.`,
    `Subtle accents in brand colours ${args.brandColors.join(", ")}.`,
    args.addText ? "Leave clean negative space for a short headline." : "No text, no letters, no logos, no watermarks.",
    "No identifiable people, no fake signage, no certificates, awards, ratings or before/after comparisons.",
  ].join(" ");
}

export const NEGATIVE_PROMPT = "text artifacts, watermark, fake logo, certificate, award, trophy, before and after, identifiable faces, storefront signage, star ratings, distorted hands";
