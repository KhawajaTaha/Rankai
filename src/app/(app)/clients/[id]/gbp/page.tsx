import Link from "next/link";
import { MapPin, RefreshCw } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { modes } from "@/lib/env";
import { ACTIONS } from "@/lib/engine/risk";
import { addDays, fmtNum } from "@/lib/utils";
import { Badge, Card, DemoBadge, EmptyState, KeyValue, LineChart, ScoreRing, Stat, StatusBadge, Tabs, fmtDate, severityTone, timeAgo } from "@/components/ui";
import { ActionButton, ActionForm, Dialog, SubmitButton } from "@/components/client";
import { assignLocationAction, connectGoogleAction, syncClientGbpAction, unassignLocationAction } from "@/app/actions/google";
import { quickJobAction } from "@/app/actions/clients";
import { pretty } from "@/lib/labels";

const SUB = ["overview", "information", "categories", "services", "posts", "photos", "performance", "recommendations", "automation", "activity"];

export default async function ClientGbp({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; select?: string; loc?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  const client = await getAccessibleClient(ctx, id);
  const locations = await db.gbpLocation.findMany({ where: { clientId: id }, orderBy: { assignedAt: "asc" }, include: { account: { include: { connection: true } }, services: true, categories: true } });
  const loc = locations.find((l) => l.id === sp.loc) ?? locations[0];
  const tab = SUB.includes(sp.tab ?? "") ? sp.tab! : "overview";
  const candidates = ctx.can("connect_gbp")
    ? await db.gbpLocation.findMany({
        where: { organizationId: ctx.orgId, clientId: null, account: { connection: { status: "CONNECTED", ...(sp.select ? { id: sp.select } : {}) } } },
        include: { account: { include: { connection: { select: { email: true, mode: true } } } } },
        orderBy: { title: "asc" },
      })
    : [];
  const sorted = candidates.sort((a, b) => Number(b.title.toLowerCase().includes(client.name.toLowerCase().split(" ")[0]!)) - Number(a.title.toLowerCase().includes(client.name.toLowerCase().split(" ")[0]!)));

  if (!loc) {
    return (
      <div className="grid gap-5 lg:grid-cols-2">
        <Card title="Method A — Client connects their own GBP" subtitle="The client clicks Connect Google Business Profile in their portal and approves access.">
          <p className="mb-4 text-sm text-ink-600">Invite the client to the portal (Settings → Portal users), or connect on their behalf if they&apos;re with you right now.</p>
          {ctx.can("connect_gbp") && (
            <form action={connectGoogleAction.bind(null, "CLIENT_GBP", id)}>
              <button className="btn-primary"><MapPin className="h-4 w-4" /> Connect with client&apos;s Google account</button>
              {!modes.googleLive() && <p className="mt-2 text-xs text-amber-700">Google credentials aren&apos;t configured — this creates a Demo connection with mocked locations.</p>}
            </form>
          )}
        </Card>
        <Card title="Method B — Assign from agency Google account" subtitle="Pick a location your agency account already manages.">
          {ctx.can("connect_gbp") ? (
            sorted.length ? (
              <ActionForm action={assignLocationAction.bind(null, id)} className="space-y-3">
                <select name="locationId" className="input" size={Math.min(8, sorted.length)}>
                  {sorted.map((l) => <option key={l.id} value={l.id}>{l.title} — {l.address ?? ""} ({l.account.connection.email}{l.account.connection.mode === "DEMO" ? ", demo" : ""})</option>)}
                </select>
                <SubmitButton>Assign to {client.name}</SubmitButton>
              </ActionForm>
            ) : <EmptyState title="No unassigned locations" description="Connect an agency Google account in Settings → Google Connections." action={<Link href="/settings/google-connections" className="btn-secondary btn-sm">Google Connections</Link>} />
          ) : <p className="text-sm text-ink-500">Ask an admin to assign the profile.</p>}
        </Card>
      </div>
    );
  }

  const since = addDays(new Date(), -90);
  const [audit, recs, posts, metrics, snapshots, activity, reviewAgg, unanswered] = await Promise.all([
    db.seoAudit.findFirst({ where: { clientId: id, kind: "GBP", status: "SUCCEEDED" }, orderBy: { createdAt: "desc" }, include: { issues: true } }),
    db.aiRecommendation.findMany({ where: { clientId: id, domain: { in: ["GBP", "REVIEWS"] } }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.gbpPost.findMany({ where: { locationId: loc.id }, orderBy: { publishedAt: "desc" }, take: 20 }),
    db.gbpMetric.findMany({ where: { locationId: loc.id, date: { gte: since } }, orderBy: { date: "asc" } }),
    db.gbpSnapshot.findMany({ where: { locationId: loc.id }, orderBy: { createdAt: "desc" }, take: 10 }),
    db.activityLog.findMany({ where: { clientId: id, category: "GBP" }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.gbpReview.aggregate({ where: { locationId: loc.id }, _count: true, _avg: { rating: true } }),
    db.gbpReview.count({ where: { locationId: loc.id, replyStatus: { not: "POSTED" } } }),
  ]);
  const conn = loc.account.connection;
  const photoCount = Number((loc.rawProfile as { photoCount?: number } | null)?.photoCount ?? 0);
  const last30 = metrics.slice(-30);
  const sum = (k: "impressionsMaps" | "impressionsSearch" | "calls" | "websiteClicks" | "directionRequests") => last30.reduce((s, m) => s + m[k], 0);
  const breakdown = (audit?.breakdown ?? {}) as Record<string, number>;
  const base = `/clients/${id}/gbp`;
  const locQ = locations.length > 1 ? `&loc=${loc.id}` : "";

  return (
    <div className="space-y-5">
      {(locations.length > 1 || (ctx.can("connect_gbp") && sorted.length > 0)) && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs font-medium text-ink-500">{locations.length} location{locations.length > 1 ? "s" : ""}:</span>
          {locations.map((l) => (
            <Link key={l.id} href={`${base}?tab=${tab}&loc=${l.id}`} className={`rounded-full px-3 py-1 text-xs ring-1 ring-inset ${l.id === loc.id ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200 hover:bg-ink-50"}`}>{l.title}{l.address ? ` · ${l.address.split(",").slice(-2, -1)[0]?.trim() ?? ""}` : ""}</Link>
          ))}
          {ctx.can("connect_gbp") && sorted.length > 0 && (
            <Dialog trigger="+ Add location" title="Add another GBP location" description="Multi-location clients get per-location posting, syncing, audits and map grids" triggerClassName="btn-secondary btn-sm">
              <ActionForm action={assignLocationAction.bind(null, id)} className="space-y-3">
                <select name="locationId" className="input" size={Math.min(8, sorted.length)}>
                  {sorted.map((l) => <option key={l.id} value={l.id}>{l.title} — {l.address ?? ""} ({l.account.connection.email}{l.account.connection.mode === "DEMO" ? ", demo" : ""})</option>)}
                </select>
                <SubmitButton>Assign to {client.name}</SubmitButton>
              </ActionForm>
            </Dialog>
          )}
          {ctx.can("connect_gbp") && locations.length > 1 && <ActionButton action={unassignLocationAction.bind(null, loc.id)} className="btn-ghost btn-sm" confirm={`Remove ${loc.title} from this client? The Google profile itself is not changed.`}>Remove this location</ActionButton>}
        </div>
      )}
      <div className="card flex flex-col gap-4 p-5 md:flex-row md:items-center">
        <ScoreRing score={client.gbpScore} size={72} label="GBP score" />
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="text-lg font-semibold">{loc.title}</h2>
            <StatusBadge status={conn.status} />
            {conn.mode === "DEMO" && <DemoBadge />}
          </div>
          <div className="text-xs text-ink-500">{loc.primaryCategory ?? "No category"} · {loc.address} · via {conn.email} · last sync {timeAgo(loc.lastSyncAt)}</div>
        </div>
        <div className="flex gap-2">
          {ctx.can("manage_gbp") && <ActionButton action={syncClientGbpAction.bind(null, id)} className="btn-secondary btn-sm"><RefreshCw className="h-3.5 w-3.5" /> Sync now</ActionButton>}
          {ctx.can("run_audit") && <ActionButton action={quickJobAction.bind(null, id, "gbp_audit")} className="btn-primary btn-sm">Run GBP Audit</ActionButton>}
        </div>
      </div>
      <Tabs active={`${base}?tab=${tab}${locQ}`} tabs={SUB.map((s) => ({ href: `${base}?tab=${s}${locQ}`, label: s.charAt(0).toUpperCase() + s.slice(1) }))} />

      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-3">
          <Card title={`GBP Score: ${client.gbpScore ?? "—"}/100`} subtitle={audit ? `Audited ${timeAgo(audit.createdAt)}` : "No audit yet"}>
            <ul className="space-y-2">
              {Object.entries(breakdown).map(([k, v]) => (
                <li key={k} className="flex items-center gap-3 text-xs">
                  <span className="w-32 text-ink-600">{pretty(k.replace(/([A-Z])/g, " $1"))}</span>
                  <div className="h-1.5 flex-1 rounded-full bg-ink-100"><div className={`h-1.5 rounded-full ${v >= 80 ? "bg-emerald-500" : v >= 50 ? "bg-amber-500" : "bg-red-500"}`} style={{ width: `${v}%` }} /></div>
                  <span className="w-8 text-right font-medium">{v}</span>
                </li>
              ))}
            </ul>
          </Card>
          <Card title="Issues" className="lg:col-span-2" pad={false}>
            {audit?.issues.length ? (
              <ul className="divide-y divide-ink-100">
                {audit.issues.map((i) => (
                  <li key={i.id} className="flex items-start gap-3 px-5 py-3">
                    <Badge tone={severityTone(i.severity)}>{i.severity.toLowerCase()}</Badge>
                    <div><div className="text-sm font-medium">{i.title}</div>{i.detail && <div className="text-xs text-ink-500">{i.detail}</div>}</div>
                  </li>
                ))}
              </ul>
            ) : <EmptyState title="No issues found" />}
          </Card>
          <div className="grid grid-cols-2 gap-3 lg:col-span-3 lg:grid-cols-5">
            <Stat label="Views (30d)" value={fmtNum(sum("impressionsMaps") + sum("impressionsSearch"))} />
            <Stat label="Calls" value={fmtNum(sum("calls"))} />
            <Stat label="Website clicks" value={fmtNum(sum("websiteClicks"))} />
            <Stat label="Directions" value={fmtNum(sum("directionRequests"))} />
            <Stat label="Reviews" value={`${reviewAgg._avg.rating?.toFixed(1) ?? "—"}★`} hint={`${reviewAgg._count} total · ${unanswered} unanswered`} href={`/clients/${id}/reviews`} />
          </div>
        </div>
      )}

      {tab === "information" && (
        <Card title="Business information" subtitle="Synced from Google. Identity fields (name, address, phone, primary category) are protected — changes require approval or are manual only.">
          <KeyValue items={[
            { label: "Business name", value: loc.title }, { label: "Primary category", value: loc.primaryCategory }, { label: "Phone", value: loc.phone }, { label: "Website", value: loc.websiteUri },
            { label: "Address", value: loc.address }, { label: "Store code", value: loc.storeCode }, { label: "Service area", value: Array.isArray(loc.serviceArea) ? (loc.serviceArea as string[]).join(", ") : "—" }, { label: "Verified", value: loc.verified ? "Yes" : "No" },
            { label: "Hours", value: loc.hours ? Object.entries(loc.hours as Record<string, string>).map(([d, h]) => `${d.slice(0, 3)} ${h}`).join(" · ") : null },
            { label: "Attributes", value: loc.attributes ? Object.entries(loc.attributes as Record<string, boolean>).filter(([, v]) => v).map(([k]) => pretty(k)).join(", ") : null },
          ]} />
          <div className="mt-5"><div className="label">Description</div><p className="whitespace-pre-wrap rounded-xl bg-ink-50 p-3 text-sm text-ink-700">{loc.description ?? "—"}</p></div>
          <div className="mt-5"><div className="label">Change history (snapshots)</div>
            <ul className="text-xs text-ink-500">{snapshots.map((s) => <li key={s.id}>{fmtDate(s.createdAt, true)} · {s.hash.slice(0, 10)}</li>)}</ul>
          </div>
        </Card>
      )}

      {tab === "categories" && (
        <Card title="Categories">
          <div className="flex flex-wrap gap-2">{loc.categories.map((c) => <Badge key={c.id} tone={c.isPrimary ? "blue" : "gray"}>{c.name}{c.isPrimary ? " (primary)" : ""}</Badge>)}</div>
          <p className="mt-4 text-xs text-ink-500">Primary category changes always require approval. Secondary categories are suggested by the AI optimization engine.</p>
        </Card>
      )}

      {tab === "services" && (
        <Card title="Services" subtitle="Services listed on Google vs. services in the AI Business Brain">
          <div className="grid gap-5 md:grid-cols-2">
            <div><div className="label">On Google</div><ul className="space-y-1 text-sm">{loc.services.map((s) => <li key={s.id} className="flex items-center gap-2">{s.name}{s.source === "platform" && <Badge tone="teal">added by platform</Badge>}</li>)}</ul></div>
            <div><div className="label">Missing from Google</div>
              <ul className="space-y-1 text-sm text-amber-700">{(await db.clientKnowledge.findUnique({ where: { clientId: id } }))?.services.filter((s) => !loc.services.some((x) => x.name.toLowerCase() === s.toLowerCase())).map((s) => <li key={s}>{s}</li>)}</ul>
            </div>
          </div>
        </Card>
      )}

      {tab === "posts" && (
        <Card title="Posts" actions={<Link href={`/clients/${id}/content`} className="link text-xs">Content calendar</Link>} pad={false}>
          <ul className="divide-y divide-ink-100">
            {posts.map((p) => (
              <li key={p.id} className="flex gap-3 px-5 py-3">
                {p.mediaUrl ? (  <img src={p.mediaUrl} alt="" className="h-16 w-20 rounded-lg object-cover" />) : <div className="h-16 w-20 rounded-lg bg-ink-100" />}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-sm text-ink-700">{p.summary}</p>
                  <div className="mt-1 text-xs text-ink-500">{fmtDate(p.publishedAt)} · {p.state} {p.verifiedAt && <Badge tone="green">verified</Badge>} {p.contentItemId && <Badge tone="blue">autopilot</Badge>}</div>
                </div>
              </li>
            ))}
          </ul>
          {!posts.length && <EmptyState title="No posts yet" />}
        </Card>
      )}

      {tab === "photos" && (
        <Card title="Photos">
          <p className="text-sm text-ink-600">{photoCount} photos on Google.</p>
          <p className="mt-2 text-xs text-ink-500">Upload new business photos to the Media Library and mark them &quot;Approved for GBP&quot; — the post engine prioritizes real approved photos over AI images.</p>
          <Link href={`/clients/${id}/content?tab=media`} className="btn-secondary btn-sm mt-3">Open Media Library</Link>
        </Card>
      )}

      {tab === "performance" && (
        <div className="space-y-5">
          <Card title="Views (90 days)"><LineChart series={[{ name: "Maps", values: metrics.map((m) => m.impressionsMaps) }, { name: "Search", values: metrics.map((m) => m.impressionsSearch) }]} labels={metrics.map((m) => m.date.toISOString().slice(5, 10))} /></Card>
          <Card title="Actions (90 days)"><LineChart series={[{ name: "Calls", values: metrics.map((m) => m.calls) }, { name: "Website clicks", values: metrics.map((m) => m.websiteClicks) }, { name: "Directions", values: metrics.map((m) => m.directionRequests) }]} labels={metrics.map((m) => m.date.toISOString().slice(5, 10))} /></Card>
        </div>
      )}

      {tab === "recommendations" && (
        <Card title="AI GBP recommendations" pad={false}>
          <ul className="divide-y divide-ink-100">
            {recs.map((r) => (
              <li key={r.id} className="px-5 py-3">
                <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{r.title}</span><StatusBadge status={r.status} /><Badge tone={r.actionClass === "AUTO_SAFE" ? "green" : r.actionClass === "PROTECTED" ? "red" : "amber"}>{r.actionClass.replace("_", "-").toLowerCase()}</Badge><Badge>{Math.round(r.confidence * 100)}%</Badge></div>
                <p className="text-xs text-ink-500">{r.reason}{r.seoBenefit ? ` · ${r.seoBenefit}` : ""}</p>
                {r.suggestedValue && <p className="mt-1 rounded-lg bg-ink-50 p-2 text-xs text-ink-700">{r.suggestedValue.slice(0, 400)}</p>}
                <div className="mt-1 text-[11px] text-ink-400">{ACTIONS[r.action]?.label} · risk {r.risk.toLowerCase()} · {timeAgo(r.createdAt)}</div>
              </li>
            ))}
          </ul>
          {!recs.length && <EmptyState title="No recommendations" />}
        </Card>
      )}

      {tab === "automation" && (
        <Card title="GBP automation" actions={<Link href={`/clients/${id}/automations`} className="btn-secondary btn-sm">Edit settings</Link>}>
          <p className="text-sm text-ink-600">Posting, AI images, review replies and safe profile edits are configured in the Automations tab. The risk engine routes each action to auto-execution, approval or manual based on automation level, consent and confidence.</p>
        </Card>
      )}

      {tab === "activity" && (
        <Card title="GBP activity" pad={false}>
          <ul className="divide-y divide-ink-100">{activity.map((a) => <li key={a.id} className="px-5 py-2.5 text-sm">{a.title}<div className="text-[11px] text-ink-400">{a.actorName} · {timeAgo(a.createdAt)}</div></li>)}</ul>
        </Card>
      )}
    </div>
  );
}
