import { NextResponse, type NextRequest } from "next/server";
import { getCtx } from "@/lib/auth";
import { db } from "@/lib/db";
import { mimeFor, readFile } from "@/lib/storage";
import { accessibleClientIds } from "@/lib/tenancy";

/**
 * Authorised file serving. Paths are <orgId>/<clientId>/<file>; the caller must belong to the
 * org and have access to the client (portal users: only their own client, and only client-visible files).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ path: string[] }> }) {
  const { path } = await params;
  if (path.length !== 3 || path.some((p) => p.includes("..") || p.includes("/"))) return new NextResponse("Not found", { status: 404 });
  const [orgId, clientId, name] = path as [string, string, string];
  const ctx = await getCtx();
  if (!ctx || ctx.orgId !== orgId) return new NextResponse("Not found", { status: 404 });
  const ids = await accessibleClientIds(ctx);
  if (ids && !ids.includes(clientId)) return new NextResponse("Not found", { status: 404 });
  const url = `/api/files/${orgId}/${clientId}/${name}`;
  if (ctx.isClientUser) {
    const file = await db.fileAsset.findFirst({ where: { url, clientId } });
    if (file && !file.clientVisible) return new NextResponse("Not found", { status: 404 });
  }
  try {
    const data = await readFile(`${orgId}/${clientId}/${name}`);
    const type = mimeFor(name);
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "content-type": type,
        "cache-control": "private, max-age=3600",
        "x-content-type-options": "nosniff",
        // SVGs are served as images only; never allow them to execute script in a browsing context.
        "content-security-policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
        ...(type.startsWith("image/") || type === "application/pdf" ? {} : { "content-disposition": `attachment; filename="${name.replace(/"/g, "")}"` }),
      },
    });
  } catch {
    return new NextResponse("Not found", { status: 404 });
  }
}
