import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { Badge, Card, EmptyState } from "@/components/ui";
import { cn } from "@/lib/utils";

const CATS = ["GBP", "WEBSITE", "SEO", "CONTENT", "SUPPORT", "AI", "CLIENT", "SYSTEM"];
const TONE: Record<string, "blue" | "teal" | "purple" | "amber" | "green" | "gray"> = { GBP: "blue", WEBSITE: "teal", SEO: "green", CONTENT: "purple", SUPPORT: "amber", AI: "purple", CLIENT: "blue", SYSTEM: "gray" };

export default async function ClientActivity({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ cat?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  await getAccessibleClient(ctx, id);
  const items = await db.activityLog.findMany({ where: { clientId: id, ...(sp.cat && CATS.includes(sp.cat) ? { category: sp.cat } : {}) }, orderBy: { createdAt: "desc" }, take: 300 });
  const byDay = new Map<string, typeof items>();
  for (const i of items) {
    const k = i.createdAt.toLocaleDateString("en-CA", { weekday: "short", month: "long", day: "numeric", year: "numeric" });
    byDay.set(k, [...(byDay.get(k) ?? []), i]);
  }
  return (
    <Card title="Client activity timeline" subtitle="One timeline for everything that happened" actions={<div className="flex flex-wrap gap-1">{["ALL", ...CATS].map((c) => <Link key={c} href={c === "ALL" ? "?" : `?cat=${c}`} className={cn("rounded-full px-2.5 py-1 text-[11px] ring-1 ring-inset", (sp.cat ?? "ALL") === c ? "bg-brand-600 text-white ring-brand-600" : "ring-ink-200")}>{c.toLowerCase()}</Link>)}</div>}>
      {items.length ? (
        <div className="space-y-6">
          {[...byDay.entries()].map(([day, list]) => (
            <div key={day}>
              <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-500">{day}</div>
              <ol className="relative ml-2 space-y-3 border-l border-ink-200 pl-5">
                {list.map((a) => (
                  <li key={a.id} className="relative">
                    <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full bg-brand-500 ring-4 ring-white" />
                    <div className="flex flex-wrap items-center gap-2 text-sm"><span className="font-medium text-ink-800">{a.title}</span><Badge tone={TONE[a.category] ?? "gray"}>{a.category.toLowerCase()}</Badge></div>
                    {a.detail && <p className="text-xs text-ink-500">{a.detail}</p>}
                    <div className="text-[11px] text-ink-400">{a.createdAt.toLocaleTimeString("en-CA", { hour: "numeric", minute: "2-digit" })} · {a.actorName ?? a.actorType.toLowerCase()} ({a.actorType.toLowerCase()})</div>
                  </li>
                ))}
              </ol>
            </div>
          ))}
        </div>
      ) : <EmptyState title="No activity yet" />}
    </Card>
  );
}
