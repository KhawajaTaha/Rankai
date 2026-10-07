import type { Report } from "@prisma/client";
import { CheckCircle2, TrendingDown, TrendingUp, AlertCircle, CalendarDays } from "lucide-react";
import { fmtNum } from "@/lib/utils";
import { Delta, fmtDate } from "./ui";

type Data = {
  done: { gbpPosts: number; blogs: number; reviewReplies: number; seoImprovements: number; imagesGenerated: number; calls: number; ticketsResolved: number };
  gbp: { views: number; viewsChange: number | null; calls: number; callsChange: number | null; websiteClicks: number; directions: number };
  search: { clicks: number; clicksChange: number | null; impressions: number };
  rankings: { avgNow: number | null; avgPrev: number | null; improved: string[]; declined: string[]; tracked: number };
  grid: { keyword: string; avg: number | null; prevAvg: number | null; top3: number | null; sov: number | null } | null;
  reviews: { new: number; avgRating: number | null };
  attention: { openHighIssues: number };
  next: { title: string; type: string; scheduledFor: string }[];
  strategy: { summary: string; priorities: { title: string; why: string }[] } | null;
};

/** Client-friendly report: what was done / improved / declined / needs attention / planned next. */
export function ReportView({ report, brand, clientName }: { report: Report; brand: string; clientName: string }) {
  const d = report.data as unknown as Data | null;
  return (
    <article className="mx-auto max-w-4xl rounded-2xl border border-ink-200 bg-white p-8 shadow-card print:border-0 print:shadow-none">
      <header className="mb-8 flex items-start justify-between border-b border-ink-100 pb-6">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-brand-600">{brand}</div>
          <h1 className="mt-1 text-2xl font-semibold">{report.title.split(" — ")[0]}</h1>
          <div className="text-sm text-ink-500">{clientName} · {fmtDate(report.periodStart)} – {fmtDate(report.periodEnd)}</div>
        </div>
      </header>
      {report.summary && (
        <section className="mb-8 rounded-2xl bg-brand-50/60 p-5">
          <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">Summary</div>
          <p className="text-[15px] leading-relaxed text-ink-800">{report.summary}</p>
        </section>
      )}
      {d && (
        <div className="space-y-8">
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="h-4 w-4 text-emerald-500" /> What was done</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[["Google posts published", d.done.gbpPosts], ["Articles published", d.done.blogs], ["Reviews replied to", d.done.reviewReplies], ["SEO improvements", d.done.seoImprovements], ["Images created", d.done.imagesGenerated], ["Support calls", d.done.calls], ["Requests resolved", d.done.ticketsResolved]].map(([l, v]) => (
                <div key={l as string} className="rounded-xl bg-ink-50 p-3"><div className="text-xl font-semibold">{fmtNum(v as number)}</div><div className="text-xs text-ink-500">{l}</div></div>
              ))}
            </div>
          </section>
          <section>
            <h2 className="mb-3 flex items-center gap-2 text-base font-semibold"><TrendingUp className="h-4 w-4 text-brand-600" /> Results</h2>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div className="rounded-xl border border-ink-200 p-3"><div className="text-xs text-ink-500">Google profile views</div><div className="text-xl font-semibold">{fmtNum(d.gbp.views)} <Delta value={d.gbp.viewsChange} /></div></div>
              <div className="rounded-xl border border-ink-200 p-3"><div className="text-xs text-ink-500">Calls from Google</div><div className="text-xl font-semibold">{fmtNum(d.gbp.calls)} <Delta value={d.gbp.callsChange} /></div></div>
              <div className="rounded-xl border border-ink-200 p-3"><div className="text-xs text-ink-500">Website visits from Google</div><div className="text-xl font-semibold">{fmtNum(d.search.clicks + d.gbp.websiteClicks)} <Delta value={d.search.clicksChange} /></div></div>
              <div className="rounded-xl border border-ink-200 p-3"><div className="text-xs text-ink-500">Average search position</div><div className="text-xl font-semibold">{d.rankings.avgNow?.toFixed(1) ?? "—"}</div>{d.rankings.avgPrev != null && <div className="text-xs text-ink-500">was {d.rankings.avgPrev.toFixed(1)}</div>}</div>
            </div>
            {d.grid && <p className="mt-3 text-sm text-ink-600">Google Maps visibility for “{d.grid.keyword}”: average position {d.grid.avg?.toFixed(1)}{d.grid.prevAvg ? ` (was ${d.grid.prevAvg.toFixed(1)})` : ""}.</p>}
          </section>
          <section className="grid gap-5 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 flex items-center gap-2 text-base font-semibold"><TrendingUp className="h-4 w-4 text-emerald-500" /> What improved</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">{d.rankings.improved.slice(0, 8).map((k) => <li key={k}>Ranking for “{k}”</li>)}{!d.rankings.improved.length && <li>Rankings held steady</li>}</ul>
            </div>
            <div>
              <h2 className="mb-2 flex items-center gap-2 text-base font-semibold"><TrendingDown className="h-4 w-4 text-red-500" /> What declined</h2>
              <ul className="list-disc space-y-1 pl-5 text-sm text-ink-700">{d.rankings.declined.slice(0, 8).map((k) => <li key={k}>Ranking for “{k}” — we&apos;re working on it</li>)}{!d.rankings.declined.length && <li>Nothing significant</li>}</ul>
            </div>
          </section>
          {d.attention.openHighIssues > 0 && (
            <section><h2 className="mb-2 flex items-center gap-2 text-base font-semibold"><AlertCircle className="h-4 w-4 text-amber-500" /> What needs attention</h2><p className="text-sm text-ink-700">{d.attention.openHighIssues} important website improvements are queued or awaiting approval.</p></section>
          )}
          <section>
            <h2 className="mb-2 flex items-center gap-2 text-base font-semibold"><CalendarDays className="h-4 w-4 text-brand-600" /> What&apos;s planned next</h2>
            {d.strategy && <ul className="mb-2 list-disc space-y-1 pl-5 text-sm text-ink-700">{d.strategy.priorities.slice(0, 4).map((p) => <li key={p.title}>{p.title}</li>)}</ul>}
            <ul className="space-y-1 text-sm text-ink-600">{d.next.map((n) => <li key={n.title + n.scheduledFor}>{new Date(n.scheduledFor).toLocaleDateString("en-CA", { month: "short", day: "numeric" })} — {n.type === "BLOG" ? "Article" : "Google post"}: {n.title}</li>)}</ul>
          </section>
        </div>
      )}
    </article>
  );
}
