import type { GoogleConnection } from "@prisma/client";
import { googleFetch } from "./google-oauth";
import { addDays, isoDate, seeded } from "../utils";

/**
 * Google Business Profile service layer. One interface, two implementations:
 *  - LiveGbp: real Google Business Profile APIs (Account Management, Business Information,
 *             My Business v4 for reviews/posts/media, Business Profile Performance)
 *  - DemoGbp: deterministic realistic data for development without credentials (Demo Mode)
 */
export interface GbpLocationData {
  name: string; // locations/123
  title: string;
  storeCode?: string;
  address?: string;
  phone?: string;
  websiteUri?: string;
  primaryCategory?: string;
  additionalCategories: string[];
  description?: string;
  hours?: Record<string, string>;
  serviceArea?: string[];
  services: { name: string; description?: string }[];
  attributes?: Record<string, boolean>;
  latitude?: number;
  longitude?: number;
  verified: boolean;
  photoCount: number;
}

export interface GbpReviewData {
  name: string;
  reviewerName: string;
  rating: number;
  comment?: string;
  createTime: string;
  reply?: string;
}

export interface GbpPostData {
  name: string;
  summary: string;
  topicType: string;
  createTime: string;
  state: string;
  mediaUrl?: string;
}

export interface GbpDailyMetric {
  date: string;
  impressionsMaps: number;
  impressionsSearch: number;
  calls: number;
  websiteClicks: number;
  directionRequests: number;
}

export interface GbpProvider {
  listAccounts(): Promise<{ name: string; accountName: string; type?: string }[]>;
  listLocations(accountName: string): Promise<GbpLocationData[]>;
  getLocation(accountName: string, locationName: string): Promise<GbpLocationData>;
  updateLocation(locationName: string, patch: { description?: string; websiteUri?: string; phone?: string; hours?: unknown; services?: { name: string; description?: string }[] }): Promise<void>;
  listReviews(accountName: string, locationName: string): Promise<GbpReviewData[]>;
  replyToReview(reviewName: string, comment: string): Promise<void>;
  listPosts(accountName: string, locationName: string): Promise<GbpPostData[]>;
  createPost(accountName: string, locationName: string, post: { summary: string; ctaType?: string; ctaUrl?: string; mediaUrl?: string }): Promise<{ name: string }>;
  getPost(postName: string): Promise<GbpPostData | null>;
  getDailyMetrics(locationName: string, days: number): Promise<GbpDailyMetric[]>;
}

export function gbpProvider(conn: GoogleConnection): GbpProvider {
  return conn.mode === "DEMO" ? new DemoGbp(conn.id) : new LiveGbp(conn);
}

// ───────────────────────────── Live ─────────────────────────────

const INFO = "https://mybusinessbusinessinformation.googleapis.com/v1";
const ACCT = "https://mybusinessaccountmanagement.googleapis.com/v1";
const V4 = "https://mybusiness.googleapis.com/v4";
const PERF = "https://businessprofileperformance.googleapis.com/v1";
const READ_MASK = "name,title,storeCode,phoneNumbers,categories,storefrontAddress,websiteUri,regularHours,serviceArea,profile,latlng,metadata,serviceItems";

interface RawLocation {
  name: string;
  title: string;
  storeCode?: string;
  phoneNumbers?: { primaryPhone?: string };
  categories?: { primaryCategory?: { displayName?: string }; additionalCategories?: { displayName?: string }[] };
  storefrontAddress?: { addressLines?: string[]; locality?: string; administrativeArea?: string; postalCode?: string };
  websiteUri?: string;
  regularHours?: { periods?: { openDay: string; openTime?: { hours?: number }; closeTime?: { hours?: number } }[] };
  serviceArea?: { places?: { placeInfos?: { placeName?: string }[] } };
  profile?: { description?: string };
  latlng?: { latitude?: number; longitude?: number };
  metadata?: { hasVoiceOfMerchant?: boolean };
  serviceItems?: { freeFormServiceItem?: { label?: { displayName?: string; description?: string } }; structuredServiceItem?: { serviceTypeId?: string; description?: string } }[];
}

function mapLocation(l: RawLocation): GbpLocationData {
  const a = l.storefrontAddress;
  const hours: Record<string, string> = {};
  for (const p of l.regularHours?.periods ?? []) hours[p.openDay] = `${p.openTime?.hours ?? 0}:00-${p.closeTime?.hours ?? 0}:00`;
  return {
    name: l.name,
    title: l.title,
    storeCode: l.storeCode,
    address: a ? [...(a.addressLines ?? []), a.locality, a.administrativeArea, a.postalCode].filter(Boolean).join(", ") : undefined,
    phone: l.phoneNumbers?.primaryPhone,
    websiteUri: l.websiteUri,
    primaryCategory: l.categories?.primaryCategory?.displayName,
    additionalCategories: (l.categories?.additionalCategories ?? []).map((c) => c.displayName ?? "").filter(Boolean),
    description: l.profile?.description,
    hours,
    serviceArea: (l.serviceArea?.places?.placeInfos ?? []).map((p) => p.placeName ?? "").filter(Boolean),
    services: (l.serviceItems ?? [])
      .map((s) => ({ name: s.freeFormServiceItem?.label?.displayName ?? s.structuredServiceItem?.serviceTypeId ?? "", description: s.freeFormServiceItem?.label?.description ?? s.structuredServiceItem?.description }))
      .filter((s) => s.name),
    latitude: l.latlng?.latitude,
    longitude: l.latlng?.longitude,
    verified: l.metadata?.hasVoiceOfMerchant ?? true,
    photoCount: 0,
  };
}

class LiveGbp implements GbpProvider {
  constructor(private conn: GoogleConnection) {}

  async listAccounts() {
    const out: { name: string; accountName: string; type?: string }[] = [];
    let pageToken: string | undefined;
    do {
      const r = await googleFetch<{ accounts?: { name: string; accountName: string; type?: string }[]; nextPageToken?: string }>(this.conn, `${ACCT}/accounts?pageSize=20${pageToken ? `&pageToken=${pageToken}` : ""}`);
      out.push(...(r.accounts ?? []));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async listLocations(accountName: string) {
    const out: GbpLocationData[] = [];
    let pageToken: string | undefined;
    do {
      const r = await googleFetch<{ locations?: RawLocation[]; nextPageToken?: string }>(
        this.conn,
        `${INFO}/${accountName}/locations?readMask=${READ_MASK}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ""}`,
      );
      out.push(...(r.locations ?? []).map(mapLocation));
      pageToken = r.nextPageToken;
    } while (pageToken);
    return out;
  }

  async getLocation(_accountName: string, locationName: string) {
    const l = await googleFetch<RawLocation>(this.conn, `${INFO}/${locationName}?readMask=${READ_MASK}`);
    return mapLocation(l);
  }

  async updateLocation(locationName: string, patch: Parameters<GbpProvider["updateLocation"]>[1]) {
    const body: Record<string, unknown> = {};
    const mask: string[] = [];
    if (patch.description !== undefined) {
      body.profile = { description: patch.description };
      mask.push("profile.description");
    }
    if (patch.websiteUri !== undefined) {
      body.websiteUri = patch.websiteUri;
      mask.push("websiteUri");
    }
    if (patch.phone !== undefined) {
      body.phoneNumbers = { primaryPhone: patch.phone };
      mask.push("phoneNumbers");
    }
    if (patch.services) {
      body.serviceItems = patch.services.map((s) => ({ freeFormServiceItem: { category: "", label: { displayName: s.name, description: s.description ?? "", languageCode: "en" } } }));
      mask.push("serviceItems");
    }
    if (!mask.length) return;
    await googleFetch(this.conn, `${INFO}/${locationName}?updateMask=${mask.join(",")}`, { method: "PATCH", body: JSON.stringify(body) });
  }

  async listReviews(accountName: string, locationName: string) {
    const out: GbpReviewData[] = [];
    let pageToken: string | undefined;
    const starMap: Record<string, number> = { ONE: 1, TWO: 2, THREE: 3, FOUR: 4, FIVE: 5 };
    do {
      const r = await googleFetch<{
        reviews?: { name: string; reviewer?: { displayName?: string }; starRating?: string; comment?: string; createTime: string; reviewReply?: { comment?: string } }[];
        nextPageToken?: string;
      }>(this.conn, `${V4}/${accountName}/${locationName}/reviews?pageSize=50${pageToken ? `&pageToken=${pageToken}` : ""}`);
      out.push(
        ...(r.reviews ?? []).map((x) => ({
          name: x.name,
          reviewerName: x.reviewer?.displayName ?? "Google user",
          rating: starMap[x.starRating ?? "FIVE"] ?? 5,
          comment: x.comment,
          createTime: x.createTime,
          reply: x.reviewReply?.comment,
        })),
      );
      pageToken = r.nextPageToken;
    } while (pageToken && out.length < 500);
    return out;
  }

  async replyToReview(reviewName: string, comment: string) {
    await googleFetch(this.conn, `${V4}/${reviewName}/reply`, { method: "PUT", body: JSON.stringify({ comment }) });
  }

  async listPosts(accountName: string, locationName: string) {
    const r = await googleFetch<{ localPosts?: { name: string; summary?: string; topicType?: string; createTime: string; state?: string; media?: { googleUrl?: string }[] }[] }>(
      this.conn,
      `${V4}/${accountName}/${locationName}/localPosts?pageSize=100`,
    );
    return (r.localPosts ?? []).map((p) => ({ name: p.name, summary: p.summary ?? "", topicType: p.topicType ?? "STANDARD", createTime: p.createTime, state: p.state ?? "LIVE", mediaUrl: p.media?.[0]?.googleUrl }));
  }

  async createPost(accountName: string, locationName: string, post: { summary: string; ctaType?: string; ctaUrl?: string; mediaUrl?: string }) {
    const body: Record<string, unknown> = { languageCode: "en", summary: post.summary, topicType: "STANDARD" };
    if (post.ctaType) body.callToAction = post.ctaType === "CALL" ? { actionType: "CALL" } : { actionType: post.ctaType, url: post.ctaUrl };
    if (post.mediaUrl && /^https:\/\//.test(post.mediaUrl)) body.media = [{ mediaFormat: "PHOTO", sourceUrl: post.mediaUrl }];
    return googleFetch<{ name: string }>(this.conn, `${V4}/${accountName}/${locationName}/localPosts`, { method: "POST", body: JSON.stringify(body) });
  }

  async getPost(postName: string) {
    try {
      const p = await googleFetch<{ name: string; summary?: string; topicType?: string; createTime: string; state?: string }>(this.conn, `${V4}/${postName}`);
      return { name: p.name, summary: p.summary ?? "", topicType: p.topicType ?? "STANDARD", createTime: p.createTime, state: p.state ?? "LIVE" };
    } catch {
      return null;
    }
  }

  async getDailyMetrics(locationName: string, days: number) {
    const end = new Date();
    const start = addDays(end, -days);
    const metrics = ["BUSINESS_IMPRESSIONS_DESKTOP_MAPS", "BUSINESS_IMPRESSIONS_MOBILE_MAPS", "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH", "BUSINESS_IMPRESSIONS_MOBILE_SEARCH", "CALL_CLICKS", "WEBSITE_CLICKS", "BUSINESS_DIRECTION_REQUESTS"];
    const qs = new URLSearchParams();
    for (const m of metrics) qs.append("dailyMetrics", m);
    qs.set("dailyRange.startDate.year", String(start.getFullYear()));
    qs.set("dailyRange.startDate.month", String(start.getMonth() + 1));
    qs.set("dailyRange.startDate.day", String(start.getDate()));
    qs.set("dailyRange.endDate.year", String(end.getFullYear()));
    qs.set("dailyRange.endDate.month", String(end.getMonth() + 1));
    qs.set("dailyRange.endDate.day", String(end.getDate()));
    const r = await googleFetch<{
      multiDailyMetricTimeSeries?: { dailyMetricTimeSeries?: { dailyMetric: string; timeSeries?: { datedValues?: { date: { year: number; month: number; day: number }; value?: string }[] } }[] }[];
    }>(this.conn, `${PERF}/${locationName}:fetchMultiDailyMetricsTimeSeries?${qs}`);
    const byDate = new Map<string, GbpDailyMetric>();
    for (const group of r.multiDailyMetricTimeSeries ?? []) {
      for (const series of group.dailyMetricTimeSeries ?? []) {
        for (const dv of series.timeSeries?.datedValues ?? []) {
          const date = `${dv.date.year}-${String(dv.date.month).padStart(2, "0")}-${String(dv.date.day).padStart(2, "0")}`;
          const row = byDate.get(date) ?? { date, impressionsMaps: 0, impressionsSearch: 0, calls: 0, websiteClicks: 0, directionRequests: 0 };
          const v = Number(dv.value ?? 0);
          if (series.dailyMetric.includes("MAPS")) row.impressionsMaps += v;
          else if (series.dailyMetric.includes("SEARCH")) row.impressionsSearch += v;
          else if (series.dailyMetric === "CALL_CLICKS") row.calls += v;
          else if (series.dailyMetric === "WEBSITE_CLICKS") row.websiteClicks += v;
          else if (series.dailyMetric === "BUSINESS_DIRECTION_REQUESTS") row.directionRequests += v;
          byDate.set(date, row);
        }
      }
    }
    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }
}

// ───────────────────────────── Demo ─────────────────────────────

export const DEMO_BUSINESSES: { title: string; category: string; city: string; services: string[]; lat: number; lng: number }[] = [
  { title: "Superior Custom Granite", category: "Countertop store", city: "Thunder Bay, ON", services: ["Granite Countertops", "Quartz Countertops", "Kitchen Countertop Installation", "Bathroom Vanities"], lat: 48.3809, lng: -89.2477 },
  { title: "Northshore Plumbing & Drain", category: "Plumber", city: "Thunder Bay, ON", services: ["Emergency Plumbing", "Drain Cleaning", "Water Heater Installation"], lat: 48.4251, lng: -89.2701 },
  { title: "Bright Smile Family Dental", category: "Dentist", city: "Sudbury, ON", services: ["Teeth Cleaning", "Dental Implants", "Teeth Whitening"], lat: 46.4917, lng: -80.993 },
  { title: "Lakehead Auto Detailing", category: "Car detailing service", city: "Thunder Bay, ON", services: ["Interior Detailing", "Ceramic Coating", "Paint Correction"], lat: 48.4012, lng: -89.2311 },
  { title: "Peak Roofing Solutions", category: "Roofing contractor", city: "Kenora, ON", services: ["Roof Replacement", "Roof Repair", "Shingle Roofing"], lat: 49.7671, lng: -94.4894 },
  { title: "Comfort Air HVAC", category: "HVAC contractor", city: "Sault Ste. Marie, ON", services: ["Furnace Repair", "AC Installation", "Duct Cleaning"], lat: 46.5219, lng: -84.3461 },
  { title: "Harbourview Law Office", category: "Lawyer", city: "Thunder Bay, ON", services: ["Real Estate Law", "Wills and Estates", "Family Law"], lat: 48.3822, lng: -89.2461 },
  { title: "Green Valley Landscaping", category: "Landscaper", city: "Dryden, ON", services: ["Lawn Care", "Landscape Design", "Snow Removal"], lat: 49.7836, lng: -92.8378 },
  { title: "Prime Physio & Wellness", category: "Physiotherapist", city: "Sudbury, ON", services: ["Sports Physiotherapy", "Massage Therapy", "Orthotics"], lat: 46.49, lng: -81.0 },
  { title: "Cedar Ridge Electrical", category: "Electrician", city: "Thunder Bay, ON", services: ["Panel Upgrades", "EV Charger Installation", "Lighting Installation"], lat: 48.41, lng: -89.26 },
  { title: "Maple Leaf Movers", category: "Moving company", city: "Timmins, ON", services: ["Local Moving", "Long Distance Moving", "Packing Services"], lat: 48.4758, lng: -81.3305 },
  { title: "Fresh Coat Painting Co.", category: "Painter", city: "Thunder Bay, ON", services: ["Interior Painting", "Exterior Painting", "Cabinet Painting"], lat: 48.39, lng: -89.28 },
];

const FIRST = ["Sarah", "Mike", "Priya", "Daniel", "Olivia", "James", "Fatima", "Chris", "Emma", "Liam", "Noah", "Ava", "Jordan", "Taylor", "Wei", "Carlos"];
const LAST = ["M.", "Thompson", "K.", "Nguyen", "R.", "Patel", "Smith", "L.", "Brown", "Garcia", "Wilson", "Chen"];
const POSITIVE = [
  "Excellent work from start to finish. The {s} looks fantastic and the crew was respectful and tidy.",
  "Very professional team. They explained everything about the {s} and finished on schedule.",
  "Great communication and fair pricing. Would recommend for {s}.",
  "Couldn't be happier with our {s}. Friendly staff and quality workmanship.",
  "Fast response and they did a great job. Thanks!",
];
const NEGATIVE = [
  "They were two days late and nobody called to let us know. The {s} is fine but communication was poor.",
  "Disappointed with the follow-up after our {s}. Still waiting for someone to return my call.",
  "Rude on the phone when I asked about the invoice.",
];

class DemoGbp implements GbpProvider {
  constructor(private connectionId: string) {}

  private biz(locationName: string) {
    const idx = Number(locationName.split("/").pop()) % DEMO_BUSINESSES.length;
    return DEMO_BUSINESSES[idx]!;
  }

  async listAccounts() {
    return [
      { name: "accounts/1001", accountName: "Agency Location Group", type: "LOCATION_GROUP" },
      { name: "accounts/1002", accountName: "Agency Personal Account", type: "PERSONAL" },
    ];
  }

  async listLocations(accountName: string) {
    const base = accountName.endsWith("1001") ? 0 : 8;
    const count = accountName.endsWith("1001") ? 8 : 4;
    return Promise.all(Array.from({ length: count }, (_, i) => this.getLocation(accountName, `locations/${base + i}`)));
  }

  async getLocation(_accountName: string, locationName: string): Promise<GbpLocationData> {
    const b = this.biz(locationName);
    const r = seeded(locationName);
    const slug = b.title.toLowerCase().replace(/[^a-z]+/g, "");
    const partial = r() > 0.5;
    return {
      name: locationName,
      title: b.title,
      storeCode: `STORE-${locationName.split("/").pop()}`,
      address: `${100 + Math.floor(r() * 800)} ${["Main St", "Red River Rd", "Memorial Ave", "Arthur St"][Math.floor(r() * 4)]}, ${b.city}`,
      phone: `(807) 555-${String(1000 + Math.floor(r() * 8999)).slice(0, 4)}`,
      websiteUri: `https://www.${slug}.example`,
      primaryCategory: b.category,
      additionalCategories: partial ? [] : [`${b.category.split(" ")[0]} supplier`],
      description: partial ? undefined : `${b.title} serves ${b.city} and surrounding areas.`,
      hours: { MONDAY: "8:00-17:00", TUESDAY: "8:00-17:00", WEDNESDAY: "8:00-17:00", THURSDAY: "8:00-17:00", FRIDAY: "8:00-16:00", ...(partial ? {} : { SATURDAY: "9:00-13:00" }) },
      serviceArea: [b.city.split(",")[0]!],
      services: b.services.slice(0, partial ? 1 : b.services.length).map((name) => ({ name })),
      attributes: { wheelchair_accessible: !partial, online_estimates: partial },
      latitude: b.lat,
      longitude: b.lng,
      verified: true,
      photoCount: partial ? 4 : 18,
    };
  }

  async updateLocation() {
    // Demo mode accepts the change; the platform persists it locally and verifies via the stored state.
  }

  async listReviews(_accountName: string, locationName: string) {
    const b = this.biz(locationName);
    const out: GbpReviewData[] = [];
    // A stable review "stream": each day has a deterministic chance of a review, so new reviews appear over time.
    for (let d = 120; d >= 0; d--) {
      const date = addDays(new Date(), -d);
      const key = `${locationName}:${isoDate(date)}`;
      const r = seeded(key);
      if (r() > 0.12) continue;
      const rating = r() < 0.08 ? 1 : r() < 0.12 ? 2 : r() < 0.2 ? 3 : r() < 0.4 ? 4 : 5;
      const service = b.services[Math.floor(r() * b.services.length)]!.toLowerCase();
      const pool = rating <= 2 ? NEGATIVE : POSITIVE;
      out.push({
        name: `${locationName}/reviews/${isoDate(date).replace(/-/g, "")}`,
        reviewerName: `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`,
        rating,
        comment: r() < 0.15 ? undefined : pool[Math.floor(r() * pool.length)]!.replace("{s}", service),
        createTime: date.toISOString(),
        reply: d > 30 && rating >= 4 && r() < 0.6 ? "Thank you for your review!" : undefined,
      });
    }
    return out;
  }

  async replyToReview() {}

  async listPosts(_accountName: string, locationName: string) {
    const r = seeded(`posts:${locationName}`);
    const lastPostDaysAgo = 5 + Math.floor(r() * 30);
    return [0, 1, 2].map((i) => ({
      name: `${locationName}/localPosts/demo${i}`,
      summary: `Update from ${this.biz(locationName).title}`,
      topicType: "STANDARD",
      createTime: addDays(new Date(), -(lastPostDaysAgo + i * 14)).toISOString(),
      state: "LIVE",
    }));
  }

  async createPost(_accountName: string, locationName: string) {
    return { name: `${locationName}/localPosts/demo-${Date.now()}` };
  }

  async getPost(postName: string) {
    return { name: postName, summary: "", topicType: "STANDARD", createTime: new Date().toISOString(), state: "LIVE" };
  }

  async getDailyMetrics(locationName: string, days: number) {
    const out: GbpDailyMetric[] = [];
    for (let d = days; d >= 1; d--) {
      const date = addDays(new Date(), -d);
      const r = seeded(`m:${locationName}:${isoDate(date)}`);
      const trend = 1 + (days - d) / (days * 3);
      const weekday = [0, 6].includes(date.getDay()) ? 0.6 : 1;
      out.push({
        date: isoDate(date),
        impressionsMaps: Math.round((60 + r() * 50) * trend * weekday),
        impressionsSearch: Math.round((40 + r() * 40) * trend * weekday),
        calls: Math.round(r() * 6 * trend * weekday),
        websiteClicks: Math.round(r() * 9 * trend * weekday),
        directionRequests: Math.round(r() * 4 * weekday),
      });
    }
    return out;
  }
}
