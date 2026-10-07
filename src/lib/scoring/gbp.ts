import type { Severity } from "@prisma/client";

export interface GbpScoreInput {
  title: string;
  description: string | null;
  primaryCategory: string | null;
  additionalCategories: number;
  services: string[];
  knownServices: string[]; // from client brain
  hasHours: boolean;
  hasPhone: boolean;
  hasWebsite: boolean;
  hasAddressOrArea: boolean;
  photoCount: number;
  recentPhotoCount: number;
  reviewCount: number;
  avgRating: number | null;
  unansweredReviews: number;
  daysSinceLastPost: number | null;
  websiteMentionsPrimaryService: boolean | null;
  descriptionMentionsCity: boolean;
  city: string;
}

export interface ScoreIssue {
  code: string;
  severity: Severity;
  title: string;
  detail?: string;
}

const WEIGHTS = {
  completeness: 15,
  categories: 10,
  services: 10,
  description: 10,
  photos: 10,
  reviews: 10,
  responses: 10,
  posting: 10,
  websiteRelevance: 7.5,
  localRelevance: 7.5,
};

/** GBP Optimization Score (0-100) with breakdown and prioritised issues (spec §14). */
export function scoreGbp(i: GbpScoreInput) {
  const issues: ScoreIssue[] = [];
  const b: Record<keyof typeof WEIGHTS, number> = {} as never;

  const completeFields = [i.description, i.primaryCategory, i.hasHours, i.hasPhone, i.hasWebsite, i.hasAddressOrArea].filter(Boolean).length;
  b.completeness = completeFields / 6;
  if (!i.hasHours) issues.push({ code: "missing_hours", severity: "HIGH", title: "Business hours are missing" });
  if (!i.hasPhone) issues.push({ code: "missing_phone", severity: "HIGH", title: "Phone number is missing" });
  if (!i.hasWebsite) issues.push({ code: "missing_website", severity: "MEDIUM", title: "Website link is missing" });

  b.categories = i.primaryCategory ? Math.min(1, 0.6 + i.additionalCategories * 0.2) : 0;
  if (!i.primaryCategory) issues.push({ code: "missing_primary_category", severity: "CRITICAL", title: "No primary category set" });
  else if (i.additionalCategories === 0) issues.push({ code: "no_secondary_categories", severity: "MEDIUM", title: "No secondary categories", detail: "Relevant secondary categories help the profile appear for more searches." });

  const svcLower = new Set(i.services.map((s) => s.toLowerCase()));
  const missing = i.knownServices.filter((s) => !svcLower.has(s.toLowerCase()));
  b.services = i.knownServices.length ? 1 - missing.length / i.knownServices.length : i.services.length ? 1 : 0;
  if (missing.length) issues.push({ code: "missing_services", severity: missing.length >= 3 ? "HIGH" : "MEDIUM", title: `${missing.length} service${missing.length > 1 ? "s" : ""} missing`, detail: missing.join(", ") });

  const dlen = i.description?.length ?? 0;
  b.description = dlen === 0 ? 0 : Math.min(1, dlen / 600) * (i.descriptionMentionsCity ? 1 : 0.8);
  if (dlen === 0) issues.push({ code: "missing_description", severity: "HIGH", title: "Business description is empty" });
  else if (dlen < 400 || !i.descriptionMentionsCity) issues.push({ code: "weak_description", severity: "MEDIUM", title: "Description could be improved", detail: dlen < 400 ? `Only ${dlen} of 750 characters used.` : `Doesn't mention ${i.city}.` });

  b.photos = Math.min(1, i.photoCount / 20) * 0.6 + Math.min(1, i.recentPhotoCount / 4) * 0.4;
  if (i.recentPhotoCount < 2) issues.push({ code: "few_recent_photos", severity: "LOW", title: "Few recent business photos" });

  b.reviews = Math.min(1, i.reviewCount / 50) * 0.6 + ((i.avgRating ?? 0) / 5) * 0.4;
  if ((i.avgRating ?? 5) < 4.2 && i.reviewCount > 3) issues.push({ code: "low_rating", severity: "HIGH", title: `Average rating ${i.avgRating?.toFixed(1)}★` });

  b.responses = i.reviewCount ? Math.max(0, 1 - i.unansweredReviews / Math.max(5, i.reviewCount)) : 1;
  if (i.unansweredReviews > 0) issues.push({ code: "unanswered_reviews", severity: i.unansweredReviews >= 5 ? "HIGH" : "MEDIUM", title: `${i.unansweredReviews} review${i.unansweredReviews > 1 ? "s" : ""} unanswered` });

  const d = i.daysSinceLastPost;
  b.posting = d == null ? 0 : d <= 7 ? 1 : d <= 14 ? 0.7 : d <= 30 ? 0.35 : 0.1;
  if (d == null || d > 7) issues.push({ code: "stale_posts", severity: d == null || d > 30 ? "HIGH" : "MEDIUM", title: d == null ? "No GBP posts yet" : `No post in ${d} days` });

  b.websiteRelevance = i.websiteMentionsPrimaryService == null ? 0.5 : i.websiteMentionsPrimaryService ? 1 : 0.3;
  if (i.websiteMentionsPrimaryService === false) issues.push({ code: "website_weak_primary_service", severity: "MEDIUM", title: "Website does not strongly mention primary service" });

  b.localRelevance = (i.descriptionMentionsCity ? 0.5 : 0) + (i.hasAddressOrArea ? 0.5 : 0);

  let score = 0;
  for (const k of Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]) score += WEIGHTS[k] * Math.max(0, Math.min(1, b[k]));
  const order: Record<Severity, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, LOW: 3 };
  issues.sort((a, c) => order[a.severity] - order[c.severity]);
  return {
    score: Math.round(score),
    breakdown: Object.fromEntries((Object.keys(WEIGHTS) as (keyof typeof WEIGHTS)[]).map((k) => [k, Math.round(b[k] * 100)])),
    issues,
  };
}
