import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { modes } from "@/lib/env";
import { pct } from "@/lib/utils";
import { Card, Delta, DemoBadge, PageHeader, Stat } from "@/components/ui";

export const metadata = { title: "Rankings" };

export default async function RankingsPage() {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const [keywords, grids] = await Promise.all([
    db.keyword.findMany({ where: scope, include: { client: { select: { id: true, name: true } } } }),
    db.localGridRun.findMany({ where: scope, orderBy: { createdAt: "desc" }, take: 300 }),
  ]);
  const byClient = new Map<string, { name: string; kws: typeof keywords }>();
  for (const k of keywords) {
    const e = byClient.get(k.clientId) ?? { name: k.client.name, kws: [] };
    e.kws.push(k);
    byClient.set(k.clientId, e);
  }
  const ranked = keywords.filter((k) => k.currentPosition != null);
  const drops = keywords.filter((k) => k.currentPosition && k.previousPosition && k.currentPosition - k.previousPosition >= 3).sort((a, b) => b.currentPosition! - b.previousPosition! - (a.currentPosition! - a.previousPosition!));
  return (
    <>
      <PageHeader title="Rankings" subtitle="Keyword and local map visibility across clients" actions={!modes.serpLive() && <DemoBadge />} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Keywords tracked" value={keywords.length} />
        <Stat label="Average position" value={ranked.length ? (ranked.reduce((s, k) => s + k.currentPosition!, 0) / ranked.length).toFixed(1) : "—"} />
        <Stat label="Top 3" value={ranked.filter((k) => k.currentPosition! <= 3).length} />
        <Stat label="Drops (3+)" value={drops.length} tone={drops.length ? "red" : "green"} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="By client" className="lg:col-span-2" pad={false}>
          <table className="w-full">
            <thead className="bg-ink-50/60"><tr>{["Client", "Keywords", "Avg position", "Top 10", "Map avg", "Share of voice"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {[...byClient.entries()].map(([cid, e]) => {
                const r = e.kws.filter((k) => k.currentPosition != null);
                const avg = r.length ? r.reduce((s, k) => s + k.currentPosition!, 0) / r.length : null;
                const prevR = e.kws.filter((k) => k.previousPosition != null);
                const prev = prevR.length ? prevR.reduce((s, k) => s + k.previousPosition!, 0) / prevR.length : null;
                const g = grids.find((x) => x.clientId === cid);
                return (
                  <tr key={cid} className="tr">
                    <td className="td"><Link href={`/clients/${cid}/rankings`} className="font-medium hover:text-brand-700">{e.name}</Link></td>
                    <td className="td">{e.kws.length}</td>
                    <td className="td">{avg?.toFixed(1) ?? "—"} {avg && prev ? <Delta value={prev - avg} suffix="" /> : null}</td>
                    <td className="td">{r.filter((k) => k.currentPosition! <= 10).length}</td>
                    <td className="td">{g?.avgPosition?.toFixed(1) ?? "—"}</td>
                    <td className="td">{pct(g?.shareOfVoice)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
        <Card title="Biggest drops" pad={false}>
          <ul className="divide-y divide-ink-100">
            {drops.slice(0, 12).map((k) => <li key={k.id} className="px-5 py-2.5 text-sm"><Link href={`/clients/${k.clientId}/rankings`} className="font-medium hover:text-brand-700">{k.phrase}</Link><div className="text-xs text-ink-500">{k.client.name} · {k.previousPosition} → <span className="text-red-600">{k.currentPosition}</span></div></li>)}
            {!drops.length && <li className="px-5 py-6 text-center text-sm text-ink-500">No significant drops</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
