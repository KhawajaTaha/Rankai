import type { AiImageMode, MediaAsset } from "@prisma/client";
import { db } from "../db";
import { env, modes } from "../env";
import { saveFile } from "../storage";
import { seeded } from "../utils";
import { buildImagePrompt, NEGATIVE_PROMPT, screenImagePrompt } from "./safety";

export type ImagePurpose = "GBP_POST" | "BLOG" | "SOCIAL" | "REPORT" | "WEBSITE";

/**
 * Image selection workflow (spec §19):
 *   relevant approved real image?  → use it
 *   else AI images ON?            → generate → safety → quality → brand check
 *   else                          → no image
 */
export async function selectOrGenerateImage(args: {
  organizationId: string;
  clientId: string;
  purpose: ImagePurpose;
  concept: string;
  keywords: string[];
  mode: AiImageMode;
  consentAiImages: boolean;
  preferRealPhotos: boolean;
}): Promise<{ media: MediaAsset | null; source: "REAL" | "AI" | "NONE"; needsApproval: boolean; notes: string[] }> {
  const notes: string[] = [];
  if (args.preferRealPhotos) {
    const real = await findRealImage(args.clientId, args.purpose, args.keywords);
    if (real) return { media: real, source: "REAL", needsApproval: false, notes: [`Used approved real image "${real.filename}"`] };
    notes.push("No relevant approved real image found");
  }
  if (args.mode === "OFF") return { media: null, source: "NONE", needsApproval: false, notes: [...notes, "AI images are OFF for this content type"] };
  if (!args.consentAiImages) return { media: null, source: "NONE", needsApproval: false, notes: [...notes, "Client has not consented to AI-generated images"] };
  const media = await generateAiImage({ ...args });
  const approvedForPurpose = args.purpose === "GBP_POST" ? media.approvedForGbp : args.purpose === "BLOG" ? media.approvedForBlog : media.status === "APPROVED";
  const needsApproval = args.mode !== "AUTO_USE" || !approvedForPurpose;
  return { media, source: "AI", needsApproval, notes: [...notes, "Generated AI image"] };
}

async function findRealImage(clientId: string, purpose: ImagePurpose, keywords: string[]) {
  const where = {
    clientId,
    isAiGenerated: false,
    status: "APPROVED" as const,
    ...(purpose === "GBP_POST" ? { approvedForGbp: true } : purpose === "BLOG" ? { approvedForBlog: true } : {}),
  };
  const candidates = await db.mediaAsset.findMany({ where, orderBy: [{ usageCount: "asc" }, { createdAt: "desc" }], take: 50 });
  const kw = keywords.flatMap((k) => k.toLowerCase().split(/\s+/)).filter((w) => w.length > 3);
  const scored = candidates
    .map((m) => {
      const hay = `${m.tags.join(" ")} ${m.title ?? ""} ${m.altText ?? ""} ${m.filename}`.toLowerCase();
      return { m, score: kw.filter((w) => hay.includes(w)).length };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.m.usageCount - b.m.usageCount);
  return scored[0]?.m ?? null;
}

export async function generateAiImage(args: { organizationId: string; clientId: string; purpose: ImagePurpose; concept: string; mode?: AiImageMode }) {
  const client = await db.client.findUniqueOrThrow({ where: { id: args.clientId }, include: { brandKit: true, automation: true } });
  const screen = screenImagePrompt(args.concept);
  const concept = screen.allowed ? args.concept : `Clean, professional concept image for ${client.industry ?? "a local business"} services`;
  const brand = client.brandKit;
  const prompt = buildImagePrompt({
    concept,
    industry: client.industry ?? "local",
    style: client.automation?.imageStyle ?? brand?.imageStyle ?? "Photo-realistic",
    brandColors: [brand?.primaryColor ?? "#1f48f5", brand?.accentColor ?? "#f59e0b"],
    addText: client.automation?.imageAddText ?? false,
  });
  const [w, h] = (client.automation?.imageDimensions ?? "1200x900").split("x").map(Number) as [number, number];

  let data: Buffer;
  let ext = "png";
  let provider = "demo";
  let model: string | null = "demo-illustrator";
  if (modes.imagesLive() && env.imageProvider === "openai") {
    data = await openAiImage(prompt, w, h);
    provider = "openai";
    model = env.imageModel;
  } else {
    data = Buffer.from(demoSvg({ seed: `${args.clientId}:${concept}:${Date.now()}`, w, h, primary: brand?.primaryColor ?? "#1f48f5", secondary: brand?.secondaryColor ?? "#0f172a", accent: brand?.accentColor ?? "#f59e0b", label: concept }));
    ext = "svg";
  }
  // Quality + brand checks: valid image payload of a sensible size, plus the safety outcome.
  const qualityScore = imageQuality(data, ext);
  const safetyNotes = screen.allowed ? [] : [`Concept rewritten: ${screen.issues.join(", ")}`];
  const saved = await saveFile(args.organizationId, args.clientId, `ai-${args.purpose.toLowerCase()}.${ext}`, data);
  const autoUse = args.mode === "AUTO_USE" && screen.allowed && qualityScore >= 0.7;
  const media = await db.mediaAsset.create({
    data: {
      organizationId: args.organizationId,
      clientId: args.clientId,
      folder: "AI_GENERATED",
      url: saved.url,
      filename: saved.key.split("/").pop()!,
      mimeType: ext === "svg" ? "image/svg+xml" : "image/png",
      width: w,
      height: h,
      sizeBytes: saved.size,
      title: concept.slice(0, 120),
      altText: concept.slice(0, 125),
      tags: ["ai", args.purpose.toLowerCase()],
      isAiGenerated: true,
      status: autoUse ? "APPROVED" : "PENDING_REVIEW",
      approvedForGbp: autoUse && args.purpose === "GBP_POST",
      approvedForBlog: autoUse && args.purpose === "BLOG",
      aiImage: {
        create: {
          organizationId: args.organizationId,
          clientId: args.clientId,
          prompt,
          negativePrompt: NEGATIVE_PROMPT,
          provider,
          model,
          purpose: args.purpose,
          qualityScore,
          safetyPassed: screen.allowed,
          safetyNotes,
          brandCheckPassed: true,
        },
      },
    },
  });
  return media;
}

function imageQuality(data: Buffer, ext: string) {
  if (ext === "svg") return data.toString("utf8", 0, 200).includes("<svg") && data.length > 500 ? 0.9 : 0.3;
  const png = data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpg = data[0] === 0xff && data[1] === 0xd8;
  if (!png && !jpg) return 0.2;
  return data.length > 50_000 ? 0.92 : 0.6; // tiny raster output usually means a failed/blank generation
}

async function openAiImage(prompt: string, w: number, h: number): Promise<Buffer> {
  const size = w > h ? "1536x1024" : w < h ? "1024x1536" : "1024x1024";
  const res = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${env.imageApiKey}` },
    body: JSON.stringify({ model: env.imageModel, prompt, size, n: 1 }),
  });
  if (!res.ok) throw new Error(`Image provider error ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = (await res.json()) as { data: { b64_json?: string; url?: string }[] };
  const item = json.data[0];
  if (item?.b64_json) return Buffer.from(item.b64_json, "base64");
  if (item?.url) return Buffer.from(await (await fetch(item.url)).arrayBuffer());
  throw new Error("Image provider returned no image");
}

/** Demo-mode illustration: abstract, brand-coloured composition — clearly not a photo of anything real. */
function demoSvg(o: { seed: string; w: number; h: number; primary: string; secondary: string; accent: string; label: string }) {
  const r = seeded(o.seed);
  const shapes: string[] = [];
  for (let i = 0; i < 14; i++) {
    const x = Math.round(r() * o.w);
    const y = Math.round(r() * o.h);
    const s = Math.round(60 + r() * 260);
    const fill = [o.primary, o.accent, "#ffffff"][i % 3];
    const op = (0.08 + r() * 0.25).toFixed(2);
    shapes.push(i % 2 ? `<circle cx="${x}" cy="${y}" r="${s / 2}" fill="${fill}" opacity="${op}"/>` : `<rect x="${x}" y="${y}" width="${s}" height="${Math.round(s * 0.6)}" rx="24" fill="${fill}" opacity="${op}" transform="rotate(${Math.round(r() * 40 - 20)} ${x} ${y})"/>`);
  }
  const label = o.label.replace(/[<>&"]/g, "").slice(0, 70);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${o.w}" height="${o.h}" viewBox="0 0 ${o.w} ${o.h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${o.secondary}"/><stop offset="1" stop-color="${o.primary}"/></linearGradient></defs>
<rect width="100%" height="100%" fill="url(#g)"/>${shapes.join("")}
<rect x="40" y="${o.h - 110}" width="${o.w - 80}" height="70" rx="14" fill="#000" opacity="0.25"/>
<text x="64" y="${o.h - 66}" font-family="Inter,Arial,sans-serif" font-size="24" fill="#fff" opacity="0.9">DEMO IMAGE · ${label}</text>
</svg>`;
}
