import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, Delta, PageHeader, Sparkline } from "@/components/ui";
import { GridHeatmap } from "@/components/heatmap";

export const metadata = { title: "Rankings" };

export default async function PortalRankings() {
  const ctx = await requirePortal();
  const [keywords, grid] = await Promise.all([
    db.keyword.findMany({ where: { clientId: ctx.portalClientId }, include: { history: { orderBy: { checkedAt: "asc" }, take: 20 } }, orderBy: { phrase: "asc" } }),
    db.localGridRun.findFirst({ where: { clientId: ctx.portalClientId }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title="Rankings" subtitle="Where you show up on Google for the searches that matter" />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Search positions" className="lg:col-span-2" pad={false}>
          <table className="w-full"><thead className="bg-ink-50/60"><tr>{["Search", "Position", "Change", "Trend"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>{keywords.map((k) => <tr key={k.id} className="tr text-sm"><td className="td">{k.phrase}</td><td className="td font-semibold">{k.currentPosition ?? "—"}</td><td className="td">{k.currentPosition && k.previousPosition ? <Delta value={k.previousPosition - k.currentPosition} suffix="" /> : "—"}</td><td className="td"><Sparkline values={k.history.map((h) => h.position)} invert /></td></tr>)}</tbody>
          </table>
        </Card>
        {grid && <Card title="Google Maps coverage" subtitle={`“${grid.keyword}” around your business`}><GridHeatmap points={grid.points as { row: number; col: number; position: number | null }[]} size={grid.gridSize} /><p className="mt-3 text-xs text-ink-500">Green = top 3 on Google Maps from that spot. Average position {grid.avgPosition?.toFixed(1)}.</p></Card>}
      </div>
    </>
  );
}
