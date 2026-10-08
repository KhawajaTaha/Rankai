import { Trash2 } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { modes } from "@/lib/env";
import { pct } from "@/lib/utils";
import { Badge, Card, Delta, DemoBadge, EmptyState, Sparkline, Stat, fmtDate, timeAgo } from "@/components/ui";
import { ActionButton, ActionForm, Dialog, Field, SubmitButton } from "@/components/client";
import { KeywordForm } from "@/components/forms";
import { GridHeatmap } from "@/components/heatmap";
import { addCompetitorAction, deleteKeywordAction, quickJobAction } from "@/app/actions/clients";

export default async function ClientRankings({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ kw?: string; loc?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  await getAccessibleClient(ctx, id);
  const [keywords, grids, competitors] = await Promise.all([
    db.keyword.findMany({ where: { clientId: id }, orderBy: [{ group: "asc" }, { phrase: "asc" }], include: { history: { orderBy: { checkedAt: "asc" }, take: 30 } } }),
    db.localGridRun.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.competitor.findMany({ where: { clientId: id }, orderBy: { avgRank: "asc" } }),
  ]);
  const gridLocations = await db.gbpLocation.findMany({ where: { clientId: id, id: { in: [...new Set(grids.map((g) => g.locationId).filter(Boolean) as string[])] } }, select: { id: true, title: true, address: true } });
  const loc = sp.loc && gridLocations.some((l) => l.id === sp.loc) ? sp.loc : gridLocations[0]?.id;
  const locGrids = gridLocations.length ? grids.filter((g) => g.locationId === loc || g.locationId == null) : grids;
  const gridKeywords = [...new Set(locGrids.map((g) => g.keyword))];
  const kw = sp.kw && gridKeywords.includes(sp.kw) ? sp.kw : gridKeywords[0];
  const runs = locGrids.filter((g) => g.keyword === kw);
  const qs = (o: Record<string, string | undefined>) => `?${new URLSearchParams(Object.entries({ kw, loc, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const cur = runs[0];
  const prev = runs[1];
  const ranked = keywords.filter((k) => k.currentPosition != null);
  const avg = ranked.length ? ranked.reduce((s, k) => s + k.currentPosition!, 0) / ranked.length : null;
  const can = ctx.can("manage_keywords");
  const demo = !modes.serpLive();

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Keywords tracked" value={keywords.length} />
        <Stat label="Average position" value={avg ? avg.toFixed(1) : "—"} />
        <Stat label="In top 3" value={ranked.filter((k) => k.currentPosition! <= 3).length} />
        <Stat label="In top 10" value={ranked.filter((k) => k.currentPosition! <= 10).length} />
      </div>
      <Card
        title="Keyword rankings"
        subtitle={demo ? "Demo SERP data — configure SERP_PROVIDER for live rankings" : "Live SERP data"}
        pad={false}
        actions={
          <>
            {demo && <DemoBadge />}
            {can && <ActionButton action={quickJobAction.bind(null, id, "ranks")}>Check now</ActionButton>}
            {can && <Dialog trigger="Add keywords" title="Add keywords" triggerClassName="btn-primary btn-sm"><KeywordForm clientId={id} /></Dialog>}
          </>
        }
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px]">
            <thead className="bg-ink-50/60"><tr>{["Keyword", "Group", "Current", "Previous", "Change", "Best", "Local", "Trend", "Volume", "Target page", "Checked", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {keywords.map((k) => {
                const change = k.currentPosition != null && k.previousPosition != null ? k.previousPosition - k.currentPosition : null;
                return (
                  <tr key={k.id} className="tr text-sm">
                    <td className="td font-medium">{k.phrase}</td>
                    <td className="td"><Badge>{k.group.toLowerCase()}</Badge></td>
                    <td className="td font-semibold">{k.currentPosition ?? "—"}</td>
                    <td className="td text-ink-500">{k.previousPosition ?? "—"}</td>
                    <td className="td">{change != null ? <Delta value={change} suffix="" /> : "—"}</td>
                    <td className="td">{k.bestPosition ?? "—"}</td>
                    <td className="td">{k.localPosition ?? "—"}</td>
                    <td className="td"><Sparkline values={k.history.map((h) => h.position)} invert /></td>
                    <td className="td">{k.searchVolume ?? "—"}</td>
                    <td className="td max-w-[160px] truncate text-xs">{k.targetUrl ?? "—"}</td>
                    <td className="td text-xs text-ink-500">{timeAgo(k.lastCheckedAt)}</td>
                    <td className="td">{can && <ActionButton action={deleteKeywordAction.bind(null, k.id)} className="btn-ghost btn-sm" confirm={`Stop tracking "${k.phrase}"?`}><Trash2 className="h-3.5 w-3.5" /></ActionButton>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!keywords.length && <EmptyState title="No keywords yet" />}
        </div>
      </Card>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Local map grid" subtitle={cur ? `${cur.gridSize}×${cur.gridSize} grid · ${cur.radiusKm} km radius · ${fmtDate(cur.createdAt)}` : undefined} className="lg:col-span-2" actions={<>{cur?.source === "DEMO" && <DemoBadge />}{can && <ActionButton action={quickJobAction.bind(null, id, "grid")}>Run grid</ActionButton>}</>}>
          {gridLocations.length > 1 && (
            <div className="mb-2 flex flex-wrap gap-1.5">{gridLocations.map((l) => <a key={l.id} href={qs({ loc: l.id })} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${l.id === loc ? "bg-ink-800 text-white ring-ink-800" : "ring-ink-200"}`} title={l.address ?? ""}>{l.title}{l.address ? ` · ${l.address.split(",").slice(-2, -1)[0]?.trim() ?? ""}` : ""}</a>)}</div>
          )}
          {gridKeywords.length > 1 && (
            <div className="mb-4 flex flex-wrap gap-1.5">{gridKeywords.map((g) => <a key={g} href={qs({ kw: g })} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${g === kw ? "bg-brand-600 text-white ring-brand-600" : "ring-ink-200"}`}>{g}</a>)}</div>
          )}
          {cur ? (
            <div className="flex flex-col gap-6 md:flex-row md:items-center">
              <GridHeatmap points={cur.points as { row: number; col: number; position: number | null }[]} size={cur.gridSize} />
              <div className="grid flex-1 grid-cols-2 gap-3">
                <Stat label="Average position" value={cur.avgPosition?.toFixed(1) ?? "—"} delta={prev?.avgPosition && cur.avgPosition ? prev.avgPosition - cur.avgPosition : null} />
                <Stat label="Top 3 coverage" value={pct(cur.top3Coverage)} delta={prev?.top3Coverage != null && cur.top3Coverage != null ? (cur.top3Coverage - prev.top3Coverage) * 100 : null} />
                <Stat label="Top 10 coverage" value={pct(cur.top10Coverage)} />
                <Stat label="Share of Local Voice" value={pct(cur.shareOfVoice)} delta={prev?.shareOfVoice != null && cur.shareOfVoice != null ? (cur.shareOfVoice - prev.shareOfVoice) * 100 : null} />
              </div>
            </div>
          ) : <EmptyState title="No grid runs yet" description="Enable map grid tracking in Automations or run one now." />}
          {runs.length > 1 && <div className="mt-4 text-xs text-ink-500">History: {runs.map((r) => `${fmtDate(r.createdAt)} avg ${r.avgPosition?.toFixed(1)}`).join(" · ")}</div>}
        </Card>
        <Card
          title="Competitors"
          subtitle={demo ? "Demo competitor data" : undefined}
          pad={false}
          actions={can && (
            <Dialog trigger="Add" title="Add competitor" triggerClassName="btn-secondary btn-sm">
              {(
                <ActionForm action={addCompetitorAction} className="grid gap-3">
                  <input type="hidden" name="clientId" value={id} />
                  <Field label="Name"><input name="name" className="input" /></Field>
                  <Field label="Website"><input name="website" className="input" /></Field>
                  <Field label="GBP category"><input name="category" className="input" /></Field>
                  <Field label="Services (comma separated)"><input name="services" className="input" /></Field>
                  <SubmitButton>Add competitor</SubmitButton>
                </ActionForm>
              )}
            </Dialog>
          )}
        >
          <ul className="divide-y divide-ink-100">
            {competitors.map((c) => (
              <li key={c.id} className="px-5 py-3 text-sm">
                <div className="flex items-center justify-between"><span className="font-medium">{c.name}</span><span className="text-xs text-ink-500">avg rank {c.avgRank ?? "—"}</span></div>
                <div className="text-xs text-ink-500">{c.rating ?? "—"}★ · {c.reviewCount ?? "—"} reviews · {c.postsPerMonth ?? "—"} posts/mo · visibility {pct(c.visibility)}</div>
                <div className="mt-1 flex flex-wrap gap-1">{c.services.map((s) => <Badge key={s}>{s}</Badge>)}</div>
              </li>
            ))}
          </ul>
          {!competitors.length && <EmptyState title="No competitors yet" />}
        </Card>
      </div>
    </div>
  );
}
