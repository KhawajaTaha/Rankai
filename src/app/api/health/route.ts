import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { modes } from "@/lib/env";

export async function GET() {
  const started = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    const [queued, failing] = await Promise.all([
      db.automationRun.count({ where: { status: { in: ["QUEUED", "RETRYING"] }, runAt: { lte: new Date() } } }),
      db.automationRun.count({ where: { status: "RUNNING", lockedAt: { lt: new Date(Date.now() - 15 * 60_000) } } }),
    ]);
    return NextResponse.json({ ok: true, db: "up", dueJobs: queued, staleJobs: failing, modes: { ai: modes.aiLive() ? "live" : "demo", google: modes.googleLive() ? "live" : "demo", images: modes.imagesLive() ? "live" : "demo", serp: modes.serpLive() ? "live" : "demo" }, ms: Date.now() - started });
  } catch {
    return NextResponse.json({ ok: false, db: "down" }, { status: 503 });
  }
}
