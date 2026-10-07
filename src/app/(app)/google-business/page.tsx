import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { addDays, fmtNum } from "@/lib/utils";
import { Badge, Card, DemoBadge, PageHeader, ScoreRing, Stat, StatusBadge, timeAgo } from "@/components/ui";

export const metadata = { title: "Google Business" };

export default async function GoogleBusinessPage() {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const [locations, metrics, unanswered, lastPosts, conns] = await Promise.all([
    db.gbpLocation.findMany({ where: { ...scope, clientId: scope.clientId ?? { not: null } }, include: { client: { select: { id: true, name: true, gbpScore: true } }, account: { include: { connection: { select: { status: true, email: true, mode: true } } } } } }),
    db.gbpMetric.groupBy({ by: ["clientId"], where: { ...scope, date: { gte: addDays(new Date(), -30) } }, _sum: { impressionsMaps: true, impressionsSearch: true, calls: true } }),
    db.gbpReview.groupBy({ by: ["clientId"], where: { ...scope, replyStatus: { not: "POSTED" } }, _count: true }),
    db.gbpPost.groupBy({ by: ["clientId"], where: scope, _max: { publishedAt: true } }),
    db.googleConnection.count({ where: { organizationId: ctx.orgId, status: { not: "CONNECTED" } } }),
  ]);
  const avg = locations.length ? Math.round(locations.reduce((s, l) => s + (l.client?.gbpScore ?? 0), 0) / locations.length) : null;
  return (
    <>
      <PageHeader title="Google Business Profiles" subtitle="Every connected profile, its health and activity" actions={ctx.can("connect_gbp") && <Link href="/settings/google-connections" className="btn-secondary">Google Connections</Link>} />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Connected profiles" value={locations.length} />
        <Stat label="Average GBP score" value={avg ?? "—"} />
        <Stat label="Unanswered reviews" value={unanswered.reduce((s, u) => s + u._count, 0)} href="/reviews" />
        <Stat label="Connection problems" value={conns} tone={conns ? "red" : "green"} href="/settings/google-connections" />
      </div>
      <Card pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["Profile", "Score", "Category", "Connection", "Views (30d)", "Calls", "Unanswered", "Last post", "Synced"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {locations.map((l) => {
              const m = metrics.find((x) => x.clientId === l.clientId)?._sum;
              const lp = lastPosts.find((x) => x.clientId === l.clientId)?._max.publishedAt;
              const stale = !lp || lp < addDays(new Date(), -7);
              return (
                <tr key={l.id} className="tr">
                  <td className="td"><Link href={`/clients/${l.clientId}/gbp`} className="font-medium hover:text-brand-700">{l.title}</Link><div className="text-xs text-ink-500">{l.client?.name}</div></td>
                  <td className="td"><ScoreRing score={l.client?.gbpScore} size={36} /></td>
                  <td className="td text-xs">{l.primaryCategory}</td>
                  <td className="td"><StatusBadge status={l.account.connection.status} /> {l.account.connection.mode === "DEMO" && <DemoBadge label="Demo" />}</td>
                  <td className="td">{fmtNum((m?.impressionsMaps ?? 0) + (m?.impressionsSearch ?? 0))}</td>
                  <td className="td">{fmtNum(m?.calls ?? 0)}</td>
                  <td className="td">{unanswered.find((u) => u.clientId === l.clientId)?._count ?? 0}</td>
                  <td className="td text-xs">{stale ? <Badge tone="amber">{lp ? timeAgo(lp) : "never"}</Badge> : timeAgo(lp)}</td>
                  <td className="td text-xs text-ink-500">{timeAgo(l.lastSyncAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
