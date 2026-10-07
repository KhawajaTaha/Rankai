import { NextResponse, type NextRequest } from "next/server";
import { safeEqual } from "@/lib/crypto";
import { workOnce } from "@/lib/jobs/runner";

/**
 * For serverless deployments without a long-running worker: call every minute with
 * Authorization: Bearer $CRON_SECRET to process due jobs (and tick the scheduler).
 */
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!secret || !safeEqual(auth, secret)) return new NextResponse("Unauthorized", { status: 401 });
  let processed = 0;
  const deadline = Date.now() + 50_000;
  while (Date.now() < deadline) {
    const n = await workOnce(10);
    processed += n;
    if (!n) break;
  }
  return NextResponse.json({ processed });
}
