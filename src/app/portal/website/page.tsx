import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { addDays } from "@/lib/utils";
import { Card, PageHeader, ScoreRing, fmtDate } from "@/components/ui";
import { ACTIONS } from "@/lib/engine/risk";

export const metadata = { title: "Website" };

export default async function PortalWebsite() {
  const ctx = await requirePortal();
  const id = ctx.portalClientId;
  const [client, site, changes, open] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id } }),
    db.website.findFirst({ where: { clientId: id } }),
    db.seoAction.findMany({ where: { clientId: id, createdAt: { gte: addDays(new Date(), -60) }, status: { not: "ROLLED_BACK" } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.seoIssue.count({ where: { clientId: id, status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
  ]);
  return (
    <>
      <PageHeader title="Website" subtitle={site?.url ?? "No website connected"} />
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Website health"><div className="flex items-center gap-4"><ScoreRing score={client.seoScore} size={72} /><div className="text-sm text-ink-600"><div>Site online: {site?.isUp == null ? "—" : site.isUp ? "Yes" : "No"}</div><div>Secure certificate until {fmtDate(site?.sslValidUntil)}</div><div>{open} important improvements in progress</div></div></div></Card>
        <Card title="Improvements we've made" className="lg:col-span-2" pad={false}>
          <ul className="divide-y divide-ink-100">{changes.map((c) => <li key={c.id} className="px-5 py-2.5 text-sm">{ACTIONS[c.field]?.label ?? c.field}<div className="truncate text-xs text-ink-400">{c.target} · {fmtDate(c.createdAt)}</div></li>)}</ul>
        </Card>
      </div>
    </>
  );
}
