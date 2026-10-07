import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { addDays } from "@/lib/utils";
import { Badge, Card, PageHeader, ScoreRing, Stat, StatusBadge, timeAgo } from "@/components/ui";

export const metadata = { title: "Website SEO" };

export default async function WebsiteSeoPage() {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const [sites, issues, fixes] = await Promise.all([
    db.website.findMany({ where: scope, include: { client: { select: { id: true, name: true, seoScore: true } }, _count: { select: { pages: true } } } }),
    db.seoIssue.groupBy({ by: ["clientId", "severity"], where: { ...scope, status: "OPEN", category: { not: "gbp" } }, _count: true }),
    db.seoAction.count({ where: { ...scope, createdAt: { gte: addDays(new Date(), -30) } } }),
  ]);
  const ints = await db.integration.findMany({ where: { ...scope, kind: { in: ["WEBSITE_WORDPRESS", "WEBSITE_GENERIC"] } } });
  const count = (cid: string, sev: string) => issues.find((i) => i.clientId === cid && i.severity === sev)?._count ?? 0;
  return (
    <>
      <PageHeader title="Website SEO" subtitle="Crawls, technical issues and safe fixes across every client site" />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Websites" value={sites.length} />
        <Stat label="Down right now" value={sites.filter((s) => s.isUp === false).length} tone={sites.some((s) => s.isUp === false) ? "red" : "green"} />
        <Stat label="Critical issues" value={issues.filter((i) => i.severity === "CRITICAL").reduce((s, i) => s + i._count, 0)} />
        <Stat label="Improvements (30d)" value={fixes} tone="green" />
      </div>
      <Card pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["Website", "SEO score", "Connector", "Pages", "Critical", "High", "Medium", "Up", "Last crawl"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {sites.map((s) => {
              const i = ints.find((x) => x.clientId === s.clientId);
              return (
                <tr key={s.id} className="tr">
                  <td className="td"><Link href={`/clients/${s.clientId}/website`} className="font-medium hover:text-brand-700">{s.url.replace(/^https?:\/\/(www\.)?/, "")}</Link><div className="text-xs text-ink-500">{s.client.name}</div></td>
                  <td className="td"><ScoreRing score={s.client.seoScore} size={36} /></td>
                  <td className="td">{i ? <StatusBadge status={i.status} label={`${i.kind === "WEBSITE_WORDPRESS" ? "WordPress" : "Generic"}${i.mode === "DEMO" ? " (demo)" : ""}`} /> : <Badge tone="amber">Not connected</Badge>}</td>
                  <td className="td">{s._count.pages}</td>
                  <td className="td">{count(s.clientId, "CRITICAL") ? <Badge tone="red">{count(s.clientId, "CRITICAL")}</Badge> : 0}</td>
                  <td className="td">{count(s.clientId, "HIGH")}</td>
                  <td className="td">{count(s.clientId, "MEDIUM")}</td>
                  <td className="td">{s.isUp == null ? "—" : s.isUp ? <Badge tone="green">up</Badge> : <Badge tone="red">down</Badge>}</td>
                  <td className="td text-xs text-ink-500">{timeAgo(s.lastCrawlAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Card>
    </>
  );
}
