"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { rescheduleContentAction } from "@/app/actions/content";

export type CalItem = { id: string; title: string; type: string; status: string; date: string; client?: string; time?: string };

const TYPE_STYLE: Record<string, string> = {
  GBP_POST: "bg-brand-50 text-brand-800 border-brand-200",
  BLOG: "bg-violet-50 text-violet-800 border-violet-200",
  SOCIAL: "bg-pink-50 text-pink-800 border-pink-200",
  WEBSITE_UPDATE: "bg-teal-50 text-teal-800 border-teal-200",
  EMAIL: "bg-amber-50 text-amber-800 border-amber-200",
  SEO_TASK: "bg-ink-100 text-ink-800 border-ink-200",
  REVIEW_CAMPAIGN: "bg-emerald-50 text-emerald-800 border-emerald-200",
};
const DOT: Record<string, string> = { PUBLISHED: "bg-emerald-500", SCHEDULED: "bg-brand-500", NEEDS_APPROVAL: "bg-amber-500", FAILED: "bg-red-500", IDEA: "bg-ink-300", PAUSED: "bg-ink-400", REJECTED: "bg-red-300" };

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function ContentCalendar({ items, canReschedule, initialView = "month" }: { items: CalItem[]; canReschedule: boolean; initialView?: "month" | "week" | "list" }) {
  const [view, setView] = useState(initialView);
  const [cursor, setCursor] = useState(() => new Date());
  const [dragId, setDragId] = useState<string | null>(null);
  const [local, setLocal] = useState(items);
  const [pending, start] = useTransition();
  const router = useRouter();

  const drop = (date: string) => {
    if (!dragId || !canReschedule) return;
    const it = local.find((i) => i.id === dragId);
    if (!it || it.status === "PUBLISHED") return;
    setLocal(local.map((i) => (i.id === dragId ? { ...i, date } : i)));
    setDragId(null);
    start(async () => {
      await rescheduleContentAction(it.id, date);
      router.refresh();
    });
  };

  const days: Date[] = [];
  if (view === "month") {
    const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
    const start0 = new Date(first);
    start0.setDate(first.getDate() - ((first.getDay() + 6) % 7));
    for (let i = 0; i < 42; i++) days.push(new Date(start0.getFullYear(), start0.getMonth(), start0.getDate() + i));
  } else {
    const s = new Date(cursor);
    s.setDate(cursor.getDate() - ((cursor.getDay() + 6) % 7));
    for (let i = 0; i < 7; i++) days.push(new Date(s.getFullYear(), s.getMonth(), s.getDate() + i));
  }
  const byDay = new Map<string, CalItem[]>();
  for (const i of local) byDay.set(i.date, [...(byDay.get(i.date) ?? []), i]);
  const shift = (n: number) => {
    const d = new Date(cursor);
    if (view === "month") d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + 7 * n);
    setCursor(d);
  };
  const today = iso(new Date());

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-xl border border-ink-200 bg-white p-0.5">
          {(["month", "week", "list"] as const).map((v) => <button key={v} type="button" onClick={() => setView(v)} className={cn("rounded-lg px-3 py-1 text-xs font-medium capitalize", view === v ? "bg-brand-600 text-white" : "text-ink-600")}>{v}</button>)}
        </div>
        {view !== "list" && (
          <>
            <button type="button" className="btn-secondary btn-sm" onClick={() => shift(-1)}><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setCursor(new Date())}>Today</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => shift(1)}><ChevronRight className="h-3.5 w-3.5" /></button>
            <span className="text-sm font-semibold">{cursor.toLocaleDateString("en-CA", { month: "long", year: "numeric" })}</span>
          </>
        )}
        <div className="ml-auto flex flex-wrap gap-3 text-[11px] text-ink-500">
          {Object.entries(DOT).slice(0, 5).map(([k, c]) => <span key={k} className="inline-flex items-center gap-1"><span className={cn("h-2 w-2 rounded-full", c)} />{k.replace("_", " ").toLowerCase()}</span>)}
          {pending && <span>Saving…</span>}
        </div>
      </div>
      {view === "list" ? (
        <ul className="divide-y divide-ink-100 rounded-2xl border border-ink-200 bg-white">
          {[...local].sort((a, b) => a.date.localeCompare(b.date)).map((i) => (
            <li key={i.id} className="flex items-center gap-3 px-4 py-2.5 text-sm">
              <span className="w-24 shrink-0 text-xs text-ink-500">{i.date}</span>
              <span className={cn("h-2 w-2 shrink-0 rounded-full", DOT[i.status] ?? "bg-ink-300")} />
              <Link href={`/content/${i.id}`} className="flex-1 truncate font-medium hover:text-brand-700">{i.title}</Link>
              {i.client && <span className="hidden truncate text-xs text-ink-500 md:block">{i.client}</span>}
              <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px]", TYPE_STYLE[i.type])}>{i.type.replace("_", " ").toLowerCase()}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-ink-200 bg-white">
          <div className="grid grid-cols-7 border-b border-ink-100 bg-ink-50/60 text-[11px] font-semibold uppercase text-ink-500">
            {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} className="px-2 py-1.5">{d}</div>)}
          </div>
          <div className="grid grid-cols-7">
            {days.map((d) => {
              const key = iso(d);
              const list = byDay.get(key) ?? [];
              const out = view === "month" && d.getMonth() !== cursor.getMonth();
              return (
                <div key={key} onDragOver={(e) => e.preventDefault()} onDrop={() => drop(key)} className={cn("border-b border-r border-ink-100 p-1.5", view === "week" ? "min-h-[260px]" : "min-h-[108px]", out && "bg-ink-50/50")}>
                  <div className={cn("mb-1 text-[11px]", key === today ? "inline-flex h-5 w-5 items-center justify-center rounded-full bg-brand-600 font-semibold text-white" : out ? "text-ink-300" : "text-ink-500")}>{d.getDate()}</div>
                  <div className="space-y-1">
                    {list.slice(0, view === "week" ? 20 : 4).map((i) => (
                      <Link key={i.id} href={`/content/${i.id}`} draggable={canReschedule && i.status !== "PUBLISHED"} onDragStart={() => setDragId(i.id)} className={cn("block truncate rounded-md border px-1.5 py-0.5 text-[11px]", TYPE_STYLE[i.type])} title={`${i.title}${i.client ? ` — ${i.client}` : ""} (${i.status})`}>
                        <span className={cn("mr-1 inline-block h-1.5 w-1.5 rounded-full align-middle", DOT[i.status] ?? "bg-ink-300")} />
                        {i.client ? `${i.client.split(" ")[0]}: ` : ""}{i.title}
                      </Link>
                    ))}
                    {list.length > 4 && view === "month" && <div className="text-[10px] text-ink-400">+{list.length - 4} more</div>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {canReschedule && view !== "list" && <p className="mt-2 text-[11px] text-ink-400">Drag items between days to reschedule. Published items are locked.</p>}
    </div>
  );
}
