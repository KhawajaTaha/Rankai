import Link from "next/link";
import { RotateCcw } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { env } from "@/lib/env";
import { searchOpportunities } from "@/lib/services/website";
import { ACTIONS } from "@/lib/engine/risk";
import { addDays, fmtNum, pct } from "@/lib/utils";
import { Badge, Card, Delta, DemoBadge, EmptyState, KeyValue, LineChart, ScoreRing, StatusBadge, Tabs, fmtDate, severityTone, timeAgo } from "@/components/ui";
import { ActionButton, ActionForm, Field, SubmitButton } from "@/components/client";
import { connectGoogleDataAction, connectWebsiteAction, disconnectIntegrationAction, quickJobAction } from "@/app/actions/clients";
import { restoreBackupAction, rollbackChangeAction, setIssueStatusAction } from "@/app/actions/ops";
import { pretty } from "@/lib/labels";

const SUB = ["overview", "issues", "pages", "changes", "search-console", "analytics", "connections"];

export default async function ClientWebsite({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; sev?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getAccessibleClient(ctx, id);
  const tab = SUB.includes(sp.tab ?? "") ? sp.tab! : "overview";
  const base = `/clients/${id}/website`;
  const [website, integrations, audit, googleConns] = await Promise.all([
    db.website.findFirst({ where: { clientId: id } }),
    db.integration.findMany({ where: { clientId: id } }),
    db.seoAudit.findFirst({ where: { clientId: id, kind: "WEBSITE", status: "SUCCEEDED" }, orderBy: { createdAt: "desc" } }),
    db.googleConnection.findMany({ where: { organizationId: ctx.orgId, status: "CONNECTED" } }),
  ]);
  const site = integrations.find((i) => i.kind.startsWith("WEBSITE"));
  const gsc = integrations.find((i) => i.kind === "GOOGLE_SEARCH_CONSOLE");
  const ga4 = integrations.find((i) => i.kind === "GOOGLE_ANALYTICS_4");
  const breakdown = (audit?.breakdown ?? {}) as Record<string, number>;
  const cms = (website?.cms ?? {}) as { theme?: string; elementor?: boolean; seoPlugin?: string; plugins?: string[] };

  return (
    <div className="space-y-5">
      <div className="card flex flex-col gap-4 p-5 md:flex-row md:items-center">
        <ScoreRing score={client.seoScore} size={72} />
        <div className="flex-1">
          <div className="flex items-center gap-2"><h2 className="text-lg font-semibold">{website?.url ?? "No website"}</h2>{site && <StatusBadge status={site.status} />}{site?.mode === "DEMO" && <DemoBadge />}</div>
          <div className="text-xs text-ink-500">
            {website ? <>Platform: {website.platform ?? "unknown"}{cms.theme ? ` · Theme: ${cms.theme}` : ""}{cms.elementor ? " · Elementor" : ""}{cms.seoPlugin ? ` · ${pretty(cms.seoPlugin)}` : ""} · Up: {website.isUp == null ? "—" : website.isUp ? "yes" : "NO"} · SSL until {fmtDate(website.sslValidUntil)} · last crawl {timeAgo(website.lastCrawlAt)}</> : "Connect a website to start technical SEO automation."}
          </div>
        </div>
        {ctx.can("run_audit") && website && <ActionButton action={quickJobAction.bind(null, id, "website_audit")} className="btn-primary btn-sm">Run Website Audit</ActionButton>}
      </div>
      <Tabs active={`${base}?tab=${tab}`} tabs={SUB.map((s) => ({ href: `${base}?tab=${s}`, label: pretty(s.replace("-", " ")) }))} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title="SEO score breakdown" subtitle={audit ? `${audit.pagesCrawled} pages · ${audit.summary}` : "No audit yet"}>
            <ul className="space-y-2">
              {Object.entries(breakdown).map(([k, v]) => (
                <li key={k} className="flex items-center gap-3 text-xs">
                  <span className="w-28 text-ink-600">{pretty(k)}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-ink-100"><div className={`h-1.5 rounded-full ${v >= 80 ? "bg-emerald-500" : v >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${v}%` }} /></div>
                  <span className="w-8 text-right font-medium">{v}</span>
                </li>
              ))}
            </ul>
          </Card>
          <IssuesSummary clientId={id} />
          <RecentChanges clientId={id} canRollback={ctx.can("rollback_changes")} limit={6} />
        </div>
      )}
      {tab === "issues" && <IssuesTable clientId={id} sev={sp.sev} canEdit={ctx.can("manage_website")} />}
      {tab === "pages" && <PagesTable websiteId={website?.id} />}
      {tab === "changes" && (
        <div className="space-y-5">
          <RecentChanges clientId={id} canRollback={ctx.can("rollback_changes")} limit={100} />
          <Backups clientId={id} canRestore={ctx.can("rollback_changes")} />
        </div>
      )}
      {tab === "search-console" && <SearchConsole clientId={id} connected={Boolean(gsc && gsc.status === "CONNECTED")} demo={gsc?.mode === "DEMO"} />}
      {tab === "analytics" && <Analytics clientId={id} connected={Boolean(ga4 && ga4.status === "CONNECTED")} demo={ga4?.mode === "DEMO"} />}
      {tab === "connections" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Website connection" subtitle="WordPress via the Local SEO Autopilot Connector plugin, or a generic site (crawl-only)">
            {site && (
              <div className="mb-4 rounded-xl border border-ink-200 p-3 text-xs">
                <div className="flex items-center justify-between"><span className="font-medium">{pretty(site.kind.replace("WEBSITE_", ""))} · {site.displayName}</span><StatusBadge status={site.status} /></div>
                {site.lastError && <p className="mt-1 text-red-600">{site.lastError}</p>}
                {ctx.can("manage_integrations") && <div className="mt-2"><ActionButton action={disconnectIntegrationAction.bind(null, site.id)} confirm="Disconnect this website? Stored credentials will be removed.">Disconnect</ActionButton></div>}
              </div>
            )}
            {ctx.can("manage_website") && (
              <ActionForm action={connectWebsiteAction.bind(null, id)} className="space-y-3">
                <Field label="Website URL"><input name="url" defaultValue={website?.url ?? client.website ?? ""} className="input" /></Field>
                <Field label="Connection type"><select name="kind" className="input"><option value="WEBSITE_WORDPRESS">WordPress (connector plugin)</option><option value="WEBSITE_GENERIC">Other platform (crawl & recommendations only)</option></select></Field>
                <Field label="Connector shared secret" hint="Leave blank to generate one. Paste the same secret in WordPress → Settings → Local SEO Autopilot."><input name="secret" className="input" placeholder="auto-generate" /></Field>
                {!env.live && <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="demo" className="h-4 w-4 rounded" /> Demo mode (no real site calls)</label>}
                <SubmitButton>Save & verify</SubmitButton>
              </ActionForm>
            )}
          </Card>
          <Card title="Google Search Console & GA4" subtitle="Uses a connected Google account (Settings → Google Connections)">
            {[gsc, ga4].filter(Boolean).map((i) => (
              <div key={i!.id} className="mb-3 flex items-center justify-between rounded-xl border border-ink-200 p-3 text-xs">
                <span>{i!.kind === "GOOGLE_ANALYTICS_4" ? "GA4" : "Search Console"} · {i!.externalId} {i!.mode === "DEMO" && <DemoBadge />}</span>
                <span className="flex items-center gap-2"><StatusBadge status={i!.status} /> last sync {timeAgo(i!.lastSyncAt)}</span>
              </div>
            ))}
            {ctx.can("manage_website") && googleConns.length > 0 ? (
              <ActionForm action={connectGoogleDataAction.bind(null, id)} className="grid gap-3 sm:grid-cols-2">
                <Field label="Service"><select name="kind" className="input"><option value="GOOGLE_SEARCH_CONSOLE">Search Console</option><option value="GOOGLE_ANALYTICS_4">Google Analytics 4</option></select></Field>
                <Field label="Google account"><select name="connectionId" className="input">{googleConns.map((g) => <option key={g.id} value={g.id}>{g.email}{g.mode === "DEMO" ? " (demo)" : ""}</option>)}</select></Field>
                <Field label="Property" hint="sc-domain:example.com, https://example.com/ or properties/123456" className="sm:col-span-2"><input name="externalId" className="input" /></Field>
                <div className="sm:col-span-2"><SubmitButton>Connect</SubmitButton></div>
              </ActionForm>
            ) : <p className="text-xs text-ink-500">Connect a Google account first.</p>}
          </Card>
        </div>
      )}
    </div>
  );
}

async function IssuesSummary({ clientId }: { clientId: string }) {
  const rows = await db.seoIssue.groupBy({ by: ["severity"], where: { clientId, status: "OPEN", category: { not: "gbp" } }, _count: true });
  const autoFixable = await db.seoIssue.count({ where: { clientId, status: "OPEN", autoFixable: true } });
  const fixed = await db.seoIssue.count({ where: { clientId, status: "FIXED", resolvedAt: { gte: addDays(new Date(), -30) } } });
  return (
    <Card title="Open issues" actions={<Link href={`/clients/${clientId}/website?tab=issues`} className="link text-xs">All issues</Link>}>
      <div className="grid grid-cols-2 gap-2">
        {(["CRITICAL", "HIGH", "MEDIUM", "LOW"] as const).map((s) => (
          <Link key={s} href={`/clients/${clientId}/website?tab=issues&sev=${s}`} className="rounded-xl border border-ink-200 px-3 py-2 hover:border-brand-300">
            <Badge tone={severityTone(s)}>{s.toLowerCase()}</Badge>
            <div className="mt-1 text-xl font-semibold">{rows.find((r) => r.severity === s)?._count ?? 0}</div>
          </Link>
        ))}
      </div>
      <p className="mt-3 text-xs text-ink-500">{autoFixable} auto-fixable · {fixed} fixed in the last 30 days</p>
    </Card>
  );
}

async function IssuesTable({ clientId, sev, canEdit }: { clientId: string; sev?: string; canEdit: boolean }) {
  const issues = await db.seoIssue.findMany({ where: { clientId, category: { not: "gbp" }, ...(sev ? { severity: sev as "HIGH" } : {}) }, orderBy: [{ status: "asc" }, { severity: "asc" }], take: 300 });
  return (
    <Card pad={false} title={`Issues${sev ? ` · ${sev.toLowerCase()}` : ""}`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["Severity", "Issue", "Category", "Page", "Auto-fix", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {issues.map((i) => (
              <tr key={i.id} className="tr">
                <td className="td"><Badge tone={severityTone(i.severity)}>{i.severity.toLowerCase()}</Badge></td>
                <td className="td"><div className="font-medium text-ink-800">{i.title}</div>{i.detail && <div className="max-w-md truncate text-xs text-ink-500">{i.detail}</div>}</td>
                <td className="td text-xs">{pretty(i.category)}</td>
                <td className="td max-w-[220px] truncate text-xs">{i.url ? new URL(i.url).pathname : "—"}</td>
                <td className="td text-xs">{i.autoFixable ? <Badge tone="green">safe fix</Badge> : <Badge>manual / approval</Badge>}</td>
                <td className="td"><StatusBadge status={i.status === "FIXED" ? "COMPLETED" : i.status === "IGNORED" ? "CANCELLED" : "OPEN"} label={pretty(i.status)} /></td>
                <td className="td">{canEdit && i.status === "OPEN" && <ActionButton action={setIssueStatusAction.bind(null, i.id, "IGNORED")} className="btn-ghost btn-sm">Ignore</ActionButton>}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!issues.length && <EmptyState title="No issues" />}
      </div>
    </Card>
  );
}

async function PagesTable({ websiteId }: { websiteId?: string }) {
  if (!websiteId) return <Card><EmptyState title="No website connected" /></Card>;
  const pages = await db.websitePage.findMany({ where: { websiteId }, orderBy: { url: "asc" } });
  return (
    <Card pad={false} title={`${pages.length} pages`}>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1000px]">
          <thead className="bg-ink-50/60"><tr>{["Page", "Status", "Title", "Meta", "H1", "Words", "Links in/out", "Alt missing", "Schema", "Builder"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {pages.map((p) => (
              <tr key={p.id} className="tr text-xs">
                <td className="td max-w-[200px] truncate font-medium">{new URL(p.url).pathname}</td>
                <td className="td"><Badge tone={p.statusCode && p.statusCode < 300 ? "green" : "red"}>{p.statusCode ?? "—"}</Badge></td>
                <td className="td max-w-[200px] truncate">{p.title ?? <span className="text-red-600">missing</span>}</td>
                <td className="td max-w-[220px] truncate">{p.metaDescription ?? <span className="text-amber-600">missing</span>}</td>
                <td className="td max-w-[160px] truncate">{p.h1 ?? <span className="text-amber-600">missing</span>}</td>
                <td className="td">{p.wordCount ?? "—"}</td>
                <td className="td">{p.internalLinksIn}/{p.internalLinksOut}</td>
                <td className="td">{p.imagesMissingAlt || "—"}</td>
                <td className="td">{p.schemaTypes.join(", ") || "—"}</td>
                <td className="td">{p.builder ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

async function RecentChanges({ clientId, canRollback, limit }: { clientId: string; canRollback: boolean; limit: number }) {
  const changes = await db.seoAction.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: limit });
  return (
    <Card title="Changes (before / after)" subtitle="Every change is recorded with who/what/why and can be rolled back where possible" className={limit < 10 ? "" : ""} pad={false} actions={limit < 10 ? <Link href={`/clients/${clientId}/website?tab=changes`} className="link text-xs">All</Link> : undefined}>
      <ul className="divide-y divide-ink-100">
        {changes.map((c) => (
          <li key={c.id} className="px-5 py-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm font-medium">{ACTIONS[c.field]?.label ?? pretty(c.field)}</span>
              <Badge tone={c.actorType === "AI" || c.actorType === "AUTOMATION" ? "purple" : "blue"}>{c.actorType === "HUMAN" ? "Human" : "AI / automation"}</Badge>
              <Badge tone={severityTone(c.risk)}>{c.risk.toLowerCase()} risk</Badge>
              <StatusBadge status={c.status} />
              {c.measuredOutcome && <Badge tone={c.measuredOutcome === "IMPROVED" ? "green" : c.measuredOutcome === "DECLINED" ? "red" : "gray"}>{pretty(c.measuredOutcome)}</Badge>}
              <span className="text-[11px] text-ink-400">{timeAgo(c.createdAt)}</span>
              {canRollback && c.rollbackable && c.status !== "ROLLED_BACK" && <span className="ml-auto"><ActionButton action={rollbackChangeAction.bind(null, c.id)} confirm="Roll back this change to its previous value?"><RotateCcw className="h-3 w-3" /> Rollback</ActionButton></span>}
            </div>
            <div className="mt-1 truncate text-[11px] text-ink-500">{c.target}</div>
            {limit >= 10 && (
              <div className="mt-2 grid gap-2 text-xs md:grid-cols-2">
                <div className="rounded-lg bg-red-50/60 p-2"><span className="font-medium text-red-700">Before: </span>{c.beforeValue?.slice(0, 300) || "—"}</div>
                <div className="rounded-lg bg-emerald-50/60 p-2"><span className="font-medium text-emerald-700">After: </span>{c.afterValue?.slice(0, 300) || "—"}</div>
              </div>
            )}
            {limit >= 10 && c.reason && <div className="mt-1 text-[11px] text-ink-400">Reason: {c.reason}</div>}
          </li>
        ))}
      </ul>
      {!changes.length && <EmptyState title="No changes yet" />}
    </Card>
  );
}

async function Backups({ clientId, canRestore }: { clientId: string; canRestore: boolean }) {
  const backups = await db.websiteBackup.findMany({ where: { clientId }, orderBy: { createdAt: "desc" }, take: 30 });
  return (
    <Card title="Backups & snapshots" subtitle="Taken automatically before important changes" pad={false}>
      <ul className="divide-y divide-ink-100">
        {backups.map((b) => (
          <li key={b.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
            <div className="min-w-0 flex-1"><div className="truncate">{b.reason}</div><div className="text-[11px] text-ink-400">{b.pageUrl} · {fmtDate(b.createdAt, true)}{b.restoredAt ? ` · restored ${timeAgo(b.restoredAt)}` : ""}</div></div>
            {canRestore && <ActionButton action={restoreBackupAction.bind(null, b.id)} confirm="Restore this snapshot to the live site?">Restore</ActionButton>}
          </li>
        ))}
      </ul>
      {!backups.length && <EmptyState title="No backups yet" />}
    </Card>
  );
}

async function SearchConsole({ clientId, connected, demo }: { clientId: string; connected: boolean; demo: boolean }) {
  if (!connected) return <Card><EmptyState title="Search Console not connected" description="Connect it in the Connections tab." /></Card>;
  const opps = await searchOpportunities(clientId);
  const since = addDays(new Date(), -90);
  const rows = await db.gscMetric.groupBy({ by: ["date"], where: { clientId, date: { gte: since } }, _sum: { clicks: true, impressions: true }, orderBy: { date: "asc" } });
  const top = await db.gscMetric.groupBy({ by: ["query"], where: { clientId, date: { gte: addDays(new Date(), -28) } }, _sum: { clicks: true, impressions: true }, _avg: { position: true }, orderBy: { _sum: { impressions: "desc" } }, take: 15 });
  const LABEL: Record<string, string> = { high_impr_low_ctr: "High impressions, low CTR", striking_distance: "Position 4–15 (close to page one)", growing: "Growing query", declining: "Declining query" };
  return (
    <div className="space-y-5">
      <Card title="Clicks & impressions (90 days)" actions={demo ? <DemoBadge /> : undefined}>
        <LineChart series={[{ name: "Impressions", values: rows.map((r) => r._sum.impressions ?? 0) }, { name: "Clicks ×10", values: rows.map((r) => (r._sum.clicks ?? 0) * 10) }]} labels={rows.map((r) => r.date.toISOString().slice(5, 10))} />
      </Card>
      <Card title="Opportunity engine" subtitle="Detected automatically; the strongest become recommendations" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[800px]">
            <thead className="bg-ink-50/60"><tr>{["Query", "Opportunity", "Position", "Impressions", "CTR", "Why / recommendation"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {opps.slice(0, 25).map((o, i) => (
                <tr key={i} className="tr text-xs">
                  <td className="td font-medium">{o.query}</td>
                  <td className="td"><Badge tone={o.type === "declining" ? "red" : o.type === "growing" ? "green" : "amber"}>{LABEL[o.type]}</Badge></td>
                  <td className="td">{o.position.toFixed(1)}</td>
                  <td className="td">{fmtNum(o.impressions)}</td>
                  <td className="td">{pct(o.ctr, 1)}</td>
                  <td className="td text-ink-500">{o.reason} {o.type === "striking_distance" ? "→ Improve title, expand page, add FAQ & internal links, create supporting blog." : o.type === "high_impr_low_ctr" ? "→ Rewrite title & meta description." : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <Card title="Top queries (28 days)" pad={false}>
        <table className="w-full"><thead className="bg-ink-50/60"><tr>{["Query", "Clicks", "Impressions", "Avg position"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>{top.map((t) => <tr key={t.query} className="tr text-xs"><td className="td">{t.query}</td><td className="td">{t._sum.clicks}</td><td className="td">{fmtNum(t._sum.impressions)}</td><td className="td">{t._avg.position?.toFixed(1)}</td></tr>)}</tbody>
        </table>
      </Card>
    </div>
  );
}

async function Analytics({ clientId, connected, demo }: { clientId: string; connected: boolean; demo: boolean }) {
  if (!connected) return <Card><EmptyState title="GA4 not connected" description="Connect it in the Connections tab." /></Card>;
  const now = new Date();
  const sum = async (from: Date, to: Date) => (await db.ga4Metric.aggregate({ where: { clientId, date: { gte: from, lt: to } }, _sum: { organicUsers: true, organicSessions: true, engagedSessions: true, conversions: true, leads: true } }))._sum;
  const periods = [
    { label: "Last week", days: 7 },
    { label: "Last month", days: 30 },
    { label: "Last 90 days", days: 90 },
  ];
  const data = await Promise.all(periods.map(async (p) => ({ ...p, cur: await sum(addDays(now, -p.days), now), prev: await sum(addDays(now, -2 * p.days), addDays(now, -p.days)) })));
  const yoyCur = await sum(addDays(now, -30), now);
  const yoyPrev = await sum(addDays(now, -395), addDays(now, -365));
  const series = await db.ga4Metric.findMany({ where: { clientId, date: { gte: addDays(now, -90) } }, orderBy: { date: "asc" } });
  const ch = (a?: number | null, b?: number | null) => (a != null && b ? ((a - b) / b) * 100 : null);
  return (
    <div className="space-y-5">
      <Card title="Organic performance comparison" actions={demo ? <DemoBadge /> : undefined} pad={false}>
        <table className="w-full"><thead className="bg-ink-50/60"><tr>{["Period", "Organic users", "Sessions", "Engaged", "Conversions", "Leads"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {[...data.map((d) => ({ label: `${d.label} vs previous`, cur: d.cur, prev: d.prev })), { label: "Last 30 days, year over year", cur: yoyCur, prev: yoyPrev }].map((r) => (
              <tr key={r.label} className="tr text-sm">
                <td className="td font-medium">{r.label}</td>
                {(["organicUsers", "organicSessions", "engagedSessions", "conversions", "leads"] as const).map((k) => <td key={k} className="td">{fmtNum(r.cur[k])} <Delta value={ch(r.cur[k], r.prev[k])} /></td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Organic users (90 days)"><LineChart series={[{ name: "Users", values: series.map((s) => s.organicUsers) }, { name: "Leads ×10", values: series.map((s) => s.leads * 10) }]} labels={series.map((s) => s.date.toISOString().slice(5, 10))} /></Card>
      <Card title="Snapshot"><KeyValue items={[{ label: "Leads (30d)", value: fmtNum(data[1]!.cur.leads) }, { label: "Conversions (30d)", value: fmtNum(data[1]!.cur.conversions) }]} /></Card>
    </div>
  );
}
