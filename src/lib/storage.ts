import fs from "node:fs/promises";
import path from "node:path";
import { randomToken } from "./crypto";

/**
 * Tenant-partitioned file storage: uploads/<orgId>/<clientId>/<name>.
 * Files are never served statically — /api/files/... authorises every read against the session.
 * Swap this module for S3/GCS in production; the interface stays the same.
 */
const ROOT = path.resolve(process.env.UPLOAD_DIR ?? "uploads");

export async function saveFile(orgId: string, clientId: string, filename: string, data: Buffer) {
  const safe = filename.toLowerCase().replace(/[^a-z0-9._-]+/g, "-").slice(-80);
  const name = `${Date.now()}-${randomToken(6)}-${safe}`;
  const dir = path.join(ROOT, orgId, clientId);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), data);
  return { url: `/api/files/${orgId}/${clientId}/${name}`, key: `${orgId}/${clientId}/${name}`, size: data.length };
}

export async function readFile(key: string) {
  const full = path.resolve(ROOT, key);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Invalid path");
  return fs.readFile(full);
}

export function mimeFor(name: string) {
  const ext = name.split(".").pop()?.toLowerCase();
  return (
    { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif", svg: "image/svg+xml", pdf: "application/pdf", txt: "text/plain", csv: "text/csv", doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" } as Record<string, string>
  )[ext ?? ""] ?? "application/octet-stream";
}
