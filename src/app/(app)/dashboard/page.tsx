import Link from "next/link";
import { AlertTriangle, ArrowRight, Bot, CalendarClock, CheckCircle2, Globe, Inbox, ListTodo, MapPin, Phone, Plus, Sparkles, Star, UserPlus, Users, Zap } from "lucide-react";
import { requireStaff, type Ctx } from "@/lib/auth";
import { db } from "@/lib/db";
import { attentionSummary, automationWins, supportClientRows } from "@/lib/queries";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { scanClients } from "@/lib/services/watchdog";
import { SUPPORT_HEALTH, STAGE_LABEL } from "@/lib/labels";
import { addDays, fmtNum, startOfDay } from "@/lib/utils";
import { Avatar, Badge, Card, EmptyState, PageHeader, ScoreRing, Stat, StatusBadge, fmtDate, severityTone, timeAgo } from "@/components/ui";
import { WidgetBoard } from "@/components/client";
import { saveDashboardLayout } from "@/app/actions/dashboard";
import { healthLabel } from "@/lib/scoring/health";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const ctx = await requireStaff();
  return ctx.experience === "support" ? <SupportDashboard ctx={ctx} /> : <AgencyDashboard ctx={ctx} />;
}

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}

// ─────────────────────────── Agency / manager dashboard ───────────────────────────

async function AgencyDashboard({ ctx }: { ctx: Ctx }) {
  const scope = await clientScopeFilter(ctx);
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const [att, wins, atRisk, clients, approvals, alerts, running, scheduled, tickets, keywordsAgg] = await Promise.all([
    attentionSummary(ctx),
    automationWins(ctx.orgId, monthStart, scope.clientId?.in ?? null),
    scanClients(ctx.orgId, { clientIds: scope.clientId?.in }),
    db.client.findMany({ where: clientWhere(ctx), orderBy: { healthScore: "asc" }, take: 50, select: { id: true, name: true, healthScore: true, gbpScore: true, seoScore: true, status: true, onboardingStage: true, logoUrl: true } }),
    db.approval.findMany({ where: { ...scope, status: "PENDING" }, orderBy: [{ risk: "desc" }, { createdAt: "asc" }], take: 6, include: { client: { select: { name: true } } } }),
    db.alert.findMany({ where: { ...scope, status: "OPEN" }, orderBy: [{ severity: "asc" }, { createdAt: "desc" }], take: 6, include: { client: { select: { name: true } } } }),
    db.automationRun.count({ where: { ...scope, status: "RUNNING" } }),
    db.automationRun.count({ where: { ...scope, status: { in: ["QUEUED", "RETRYING"] } } }),
    ctx.can("manage_support") ? db.supportTicket.groupBy({ by: ["assignedToId"], where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] } }, _count: true }) : Promise.resolve([]),
    db.keyword.findMany({ where: { ...scope, currentPosition: { not: null } }, select: { currentPosition: true, previousPosition: true } }),
  ]);
  const layout = ((await db.organizationUser.findUnique({ where: { id: ctx.memberId }, select: { dashboardLayout: true } }))?.dashboardLayout as { order?: string[] } | null)?.order;
  const defaultOrder = ctx.roleKey === "support_manager" ? ["followups", "agents", "atrisk", "approvals", "alerts", "health", "wins", "rankings"] : ["alerts", "approvals", "atrisk", "rankings", "health", "wins", "agents"];
  const attentionItems = [
    { n: att.approvals, label: "Approvals", href: "/approvals", icon: CheckCircle2 },
    { n: att.brokenGoogle, label: "Connections Failed", href: "/integrations", icon: Globe },
    { n: att.urgentReviews, label: "Urgent Reviews", href: "/reviews?filter=negative", icon: Star },
    { n: att.websiteProblems, label: "Website Problems", href: "/alerts", icon: AlertTriangle },
    { n: att.followUps, label: "Client Follow-Ups", href: "/support/follow-ups", icon: CalendarClock },
    { n: att.requests, label: "Client Requests", href: "/support/tickets", icon: Inbox },
    { n: att.failedRuns, label: "Failed Automations", href: "/automations/history?status=failed", icon: Bot },
  ].filter((i) => i.n > 0);
  const improved = keywordsAgg.filter((k) => k.previousPosition && k.currentPosition! < k.previousPosition).length;
  const declined = keywordsAgg.filter((k) => k.previousPosition && k.currentPosition! > k.previousPosition).length;
  const avgPos = keywordsAgg.length ? keywordsAgg.reduce((s, k) => s + k.currentPosition!, 0) / keywordsAgg.length : null;
  const members = ticketsMembers(await db.organizationUser.findMany({ where: { organizationId: ctx.orgId, role: { key: { in: ["support_agent", "support_manager"] } } }, include: { user: true } }));
  const overdueFollowUps = ctx.can("manage_support") ? await db.followUp.groupBy({ by: ["assignedToId"], where: { ...scope, completedAt: null, dueAt: { lt: new Date() } }, _count: true }) : [];

  const widgets = [
    {
      id: "alerts", title: "Alerts", span: 1 as const,
      node: (
        <Card title="Alerts" actions={<Link href="/alerts" className="link text-xs">View all</Link>} pad={false}>
          {alerts.length ? (
            <ul className="divide-y divide-ink-100">
              {alerts.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-5 py-3">
                  <Badge tone={severityTone(a.severity)}>{a.severity.toLowerCase()}</Badge>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-800">{a.title}</div>
                    <div className="text-xs text-ink-500">{a.client?.name ?? "Agency"} · {timeAgo(a.createdAt)}</div>
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No open alerts" />}
        </Card>
      ),
    },
    {
      id: "approvals", title: "Approvals", span: 1 as const,
      node: (
        <Card title="Waiting for approval" actions={<Link href="/approvals" className="link text-xs">Approval Center</Link>} pad={false}>
          {approvals.length ? (
            <ul className="divide-y divide-ink-100">
              {approvals.map((a) => (
                <li key={a.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-medium text-ink-800">{a.title}</span>
                    <Badge tone={severityTone(a.risk)}>{a.risk.toLowerCase()} risk</Badge>
                  </div>
                  <div className="text-xs text-ink-500">{a.client.name} · {a.category.toLowerCase()} · {timeAgo(a.createdAt)}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Nothing waiting" />}
        </Card>
      ),
    },
    {
      id: "atrisk", title: "Clients at risk", span: 1 as const,
      node: (
        <Card title="Clients at risk" subtitle="No-work-forgotten watchdog" pad={false}>
          {atRisk.length ? (
            <ul className="divide-y divide-ink-100">
              {atRisk.slice(0, 6).map((r) => (
                <li key={r.clientId} className="px-5 py-3">
                  <Link href={`/clients/${r.clientId}`} className="text-sm font-medium text-ink-800 hover:text-brand-700">{r.name}</Link>
                  <div className="mt-1 flex flex-wrap gap-1">{r.flags.slice(0, 3).map((f) => <Badge key={f.code} tone={severityTone(f.severity)}>{f.label}</Badge>)}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Every client is on track" />}
        </Card>
      ),
    },
    {
      id: "rankings", title: "Rankings", span: 1 as const,
      node: (
        <Card title="Rankings" actions={<Link href="/rankings" className="link text-xs">Open</Link>}>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div><div className="text-xl font-semibold">{avgPos ? avgPos.toFixed(1) : "—"}</div><div className="text-xs text-ink-500">Avg position</div></div>
            <div><div className="text-xl font-semibold text-emerald-600">{improved}</div><div className="text-xs text-ink-500">Improved</div></div>
            <div><div className="text-xl font-semibold text-red-600">{declined}</div><div className="text-xs text-ink-500">Declined</div></div>
          </div>
          <p className="mt-3 text-xs text-ink-500">{keywordsAgg.length} keywords tracked across accessible clients.</p>
        </Card>
      ),
    },
    {
      id: "health", title: "Client health", span: 1 as const,
      node: (
        <Card title="Client health" actions={<Link href="/clients" className="link text-xs">All clients</Link>} pad={false}>
          <ul className="divide-y divide-ink-100">
            {clients.slice(0, 7).map((c) => {
              const h = healthLabel(c.healthScore);
              return (
                <li key={c.id} className="flex items-center gap-3 px-5 py-2.5">
                  <ScoreRing score={c.healthScore} size={36} />
                  <Link href={`/clients/${c.id}`} className="flex-1 truncate text-sm font-medium text-ink-800 hover:text-brand-700">{c.name}</Link>
                  <Badge tone={h.tone}>{h.label}</Badge>
                </li>
              );
            })}
          </ul>
        </Card>
      ),
    },
    {
      id: "wins", title: "Automation success", span: 1 as const,
      node: (
        <Card title="This month AI completed" subtitle="Work the platform did so your team didn't have to">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["GBP Posts", wins.posts], ["Images Generated", wins.images], ["Reviews Replied", wins.replies], ["Blogs Generated", wins.blogs],
              ["SEO Fixes", wins.fixes], ["Internal Links", wins.links], ["Reports", wins.reports],
            ].map(([l, v]) => (
              <div key={l as string} className="rounded-xl bg-ink-50 px-3 py-2">
                <div className="text-lg font-semibold text-ink-900">{fmtNum(v as number)}</div>
                <div className="text-[11px] text-ink-500">{l}</div>
              </div>
            ))}
          </div>
        </Card>
      ),
    },
    ...(ctx.can("manage_support")
      ? [
          {
            id: "agents", title: "Agent workload", span: 1 as const,
            node: (
              <Card title="Support workload" actions={<Link href="/support/performance" className="link text-xs">Performance</Link>} pad={false}>
                <ul className="divide-y divide-ink-100">
                  {members.map((m) => (
                    <li key={m.id} className="flex items-center gap-3 px-5 py-2.5">
                      <Avatar name={m.name} size={28} />
                      <span className="flex-1 truncate text-sm">{m.name}</span>
                      <span className="text-xs text-ink-500">{tickets.find((t) => t.assignedToId === m.id)?._count ?? 0} open requests</span>
                      {(overdueFollowUps.find((o) => o.assignedToId === m.id)?._count ?? 0) > 0 && <Badge tone="red">{overdueFollowUps.find((o) => o.assignedToId === m.id)?._count} overdue</Badge>}
                    </li>
                  ))}
                </ul>
              </Card>
            ),
          },
          {
            id: "followups", title: "Follow-ups", span: 1 as const,
            node: <Stat label="Follow-ups due today or overdue" value={att.followUps} icon={<CalendarClock className="h-4 w-4" />} href="/support/follow-ups" tone={att.followUps ? "amber" : "green"} hint={`${att.requests} open client requests`} />,
          },
        ]
      : []),
  ];

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${ctx.user.name.split(" ")[0]}`}
        subtitle="Here's what needs your attention. Everything else is running on autopilot."
        actions={
          <>
            {ctx.can("create_client") && <Link href="/clients/new" className="btn-primary"><Plus className="h-4 w-4" /> Add Client</Link>}
            {ctx.can("use_agency_assistant") && <Link href="/assistant" className="btn-secondary"><Sparkles className="h-4 w-4" /> Ask AI</Link>}
          </>
        }
      />
      <section className="card mb-6 overflow-hidden">
        <div className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center">
          <div className="lg:w-56">
            <div className="text-xs font-semibold uppercase tracking-wide text-ink-500">Your attention is needed</div>
            <div className="mt-1 text-2xl font-semibold">{attentionItems.reduce((s, i) => s + i.n, 0)} items</div>
          </div>
          <div className="grid flex-1 grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-7">
            {attentionItems.length ? attentionItems.map((i) => (
              <Link key={i.label} href={i.href} className="group rounded-xl border border-ink-200 px-3 py-2.5 transition hover:border-brand-300 hover:bg-brand-50/40">
                <div className="flex items-center gap-2 text-ink-500"><i.icon className="h-3.5 w-3.5" /><span className="truncate text-[11px] font-medium">{i.label}</span></div>
                <div className="mt-1 text-xl font-semibold text-ink-900">{i.n}</div>
              </Link>
            )) : <div className="col-span-full flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="h-4 w-4" /> Nothing needs you right now.</div>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-t border-ink-100 bg-emerald-50/50 px-5 py-2.5 text-xs text-emerald-800">
          <span className="inline-flex items-center gap-1.5 font-medium"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" /> Everything else: running normally</span>
          <span>{running} job(s) running</span>
          <span>{scheduled} scheduled</span>
          <span>{clients.length} clients monitored</span>
          {ctx.can("view_command_center") && <Link href="/automations" className="ml-auto inline-flex items-center gap-1 font-medium hover:underline">Command Center <ArrowRight className="h-3 w-3" /></Link>}
        </div>
      </section>
      <WidgetBoard widgets={widgets} order={layout ?? defaultOrder} save={saveDashboardLayout} />
    </>
  );
}

function ticketsMembers(rows: { id: string; user: { name: string } }[]) {
  return rows.map((r) => ({ id: r.id, name: r.user.name }));
}

// ─────────────────────────── Support agent dashboard ───────────────────────────

async function SupportDashboard({ ctx }: { ctx: Ctx }) {
  const today = startOfDay();
  const tomorrow = addDays(today, 1);
  const clients = await supportClientRows(ctx, { onlyMine: true });
  const ids = clients.map((c) => c.id);
  const [followUpsDue, overdueTasks, requests, newReviews, pendingApprovals, onboarding, myTasks, calls] = await Promise.all([
    db.followUp.findMany({ where: { organizationId: ctx.orgId, clientId: { in: ids }, completedAt: null, dueAt: { lt: tomorrow } }, include: { client: { select: { name: true, phone: true } } }, orderBy: { dueAt: "asc" } }),
    db.task.count({ where: { organizationId: ctx.orgId, assignedToId: ctx.memberId, status: { notIn: ["COMPLETED", "CANCELLED"] }, dueAt: { lt: new Date() } } }),
    db.supportTicket.findMany({ where: { organizationId: ctx.orgId, clientId: { in: ids }, status: { in: ["OPEN", "IN_PROGRESS"] } }, include: { client: { select: { name: true } } }, orderBy: { slaDueAt: "asc" }, take: 6 }),
    db.gbpReview.count({ where: { organizationId: ctx.orgId, clientId: { in: ids }, reviewedAt: { gte: addDays(today, -7) } } }),
    db.approval.count({ where: { organizationId: ctx.orgId, clientId: { in: ids }, status: "PENDING", requiresClient: true } }),
    clients.filter((c) => c.status === "ONBOARDING").length,
    db.task.findMany({ where: { organizationId: ctx.orgId, assignedToId: ctx.memberId, status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: [{ dueAt: "asc" }], take: 6, include: { client: { select: { name: true } } } }),
    db.supportCall.count({ where: { organizationId: ctx.orgId, createdById: ctx.memberId, occurredAt: { gte: today } } }),
  ]);
  const needAttention = clients.filter((c) => ["URGENT", "NEEDS_FOLLOW_UP", "SEO_ATTENTION_NEEDED"].includes(c.supportHealth));
  return (
    <>
      <PageHeader
        title={`${greeting()}, ${ctx.user.name.split(" ")[0]}`}
        subtitle={`Today's overview · ${new Date().toLocaleDateString("en-CA", { weekday: "long", month: "long", day: "numeric" })}`}
        actions={
          <>
            {ctx.can("create_client") && <Link href="/clients/new" className="btn-primary"><UserPlus className="h-4 w-4" /> Add New Client</Link>}
            <Link href="/support/calls" className="btn-secondary"><Phone className="h-4 w-4" /> Log a call</Link>
          </>
        }
      />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Clients Assigned" value={clients.length} icon={<Users className="h-4 w-4" />} href="/clients" />
        <Stat label="Calls Today" value={calls} icon={<Phone className="h-4 w-4" />} href="/support/calls" />
        <Stat label="Follow-Ups Due" value={followUpsDue.length} icon={<CalendarClock className="h-4 w-4" />} href="/support/follow-ups" tone={followUpsDue.length ? "amber" : "green"} />
        <Stat label="Overdue Tasks" value={overdueTasks} icon={<ListTodo className="h-4 w-4" />} href="/tasks?filter=overdue" tone={overdueTasks ? "red" : "green"} />
        <Stat label="Client Requests" value={requests.length} icon={<Inbox className="h-4 w-4" />} href="/support/tickets" tone={requests.length ? "amber" : undefined} />
        <Stat label="Need Attention" value={needAttention.length} icon={<AlertTriangle className="h-4 w-4" />} tone={needAttention.length ? "red" : "green"} />
        <Stat label="New Reviews (7d)" value={newReviews} icon={<Star className="h-4 w-4" />} />
        <Stat label="Client Approvals" value={pendingApprovals} icon={<CheckCircle2 className="h-4 w-4" />} hint={`${onboarding} onboarding`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="Today's follow-ups & calls due" className="xl:col-span-1" pad={false}>
          {followUpsDue.length ? (
            <ul className="divide-y divide-ink-100">
              {followUpsDue.map((f) => (
                <li key={f.id} className="px-5 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <Link href={`/clients/${f.clientId}/support`} className="truncate text-sm font-medium hover:text-brand-700">{f.client.name}</Link>
                    <Badge tone={f.dueAt < new Date() ? "red" : "amber"}>{f.dueAt < new Date() ? "Overdue" : "Due today"}</Badge>
                  </div>
                  <div className="text-xs text-ink-500">{f.title}{f.client.phone ? ` · ${f.client.phone}` : ""}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No follow-ups due" description="You're all caught up for today." />}
        </Card>
        <Card title="Client requests" pad={false} actions={<Link href="/support/tickets" className="link text-xs">All requests</Link>}>
          {requests.length ? (
            <ul className="divide-y divide-ink-100">
              {requests.map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <Link href={`/support/tickets/${t.id}`} className="text-sm font-medium hover:text-brand-700">#{t.number} {t.subject}</Link>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-ink-500">
                    {t.client.name} · <Badge tone={severityTone(t.priority)}>{t.priority.toLowerCase()}</Badge>
                    {t.slaDueAt && <span className={t.slaDueAt < new Date() ? "text-red-600" : ""}>SLA {timeAgo(t.slaDueAt)}</span>}
                  </div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Inbox className="h-5 w-5" />} title="No open requests" />}
        </Card>
        <Card title="My tasks" pad={false} actions={<Link href="/tasks" className="link text-xs">All tasks</Link>}>
          {myTasks.length ? (
            <ul className="divide-y divide-ink-100">
              {myTasks.map((t) => (
                <li key={t.id} className="px-5 py-3">
                  <div className="truncate text-sm font-medium">{t.title}</div>
                  <div className="text-xs text-ink-500">{t.client?.name ?? "—"} · due {timeAgo(t.dueAt)}</div>
                </li>
              ))}
            </ul>
          ) : <EmptyState icon={<Zap className="h-5 w-5" />} title="No open tasks" />}
        </Card>
      </div>

      <Card title="My assigned clients" subtitle="Your clients, their status and what's next" className="mt-4" pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-ink-50/60">
              <tr>{["Business", "Location", "Phone", "Website", "SEO", "GBP", "Last Contact", "Next Follow-Up", "Open Tasks", "Requests", "Last Note", "Status"].map((h) => <th key={h} className="th">{h}</th>)}</tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const gbp = c.locations[0];
                const sh = SUPPORT_HEALTH[c.supportHealth];
                return (
                  <tr key={c.id} className="tr">
                    <td className="td">
                      <Link href={`/clients/${c.id}`} className="flex items-center gap-2.5">
                        <Avatar name={c.name} src={c.logoUrl} size={30} square />
                        <span className="font-medium text-ink-900 hover:text-brand-700">{c.name}</span>
                      </Link>
                    </td>
                    <td className="td whitespace-nowrap">{c.city ?? "—"}</td>
                    <td className="td whitespace-nowrap">{c.phone ? <a href={`tel:${c.phone}`} className="link">{c.phone}</a> : "—"}</td>
                    <td className="td max-w-[140px] truncate">{c.website ? <a href={c.website} target="_blank" rel="noreferrer" className="link">{c.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}</a> : "—"}</td>
                    <td className="td"><ScoreRing score={c.seoScore} size={32} /></td>
                    <td className="td">{gbp ? <StatusBadge status={gbp.account.connection.status} /> : <Badge tone="amber">Not connected</Badge>}</td>
                    <td className="td whitespace-nowrap text-xs">{timeAgo(c.lastContactAt)}</td>
                    <td className="td whitespace-nowrap text-xs">{c.nextFollowUpAt ? <span className={c.nextFollowUpAt < new Date() ? "font-medium text-red-600" : ""}>{fmtDate(c.nextFollowUpAt)}</span> : "—"}</td>
                    <td className="td text-center">{c._count.tasks}</td>
                    <td className="td text-center">{c._count.tickets}</td>
                    <td className="td max-w-[200px] truncate text-xs text-ink-500" title={c.notes[0]?.body}>{c.notes[0]?.body ?? "—"}</td>
                    <td className="td"><Badge tone={sh.tone}>{sh.label}</Badge>{c.status === "ONBOARDING" && <div className="mt-1 text-[10px] text-ink-400">{STAGE_LABEL[c.onboardingStage]}</div>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!clients.length && <EmptyState icon={<Users className="h-5 w-5" />} title="No clients assigned yet" description="Clients you create or that are assigned to you appear here." action={ctx.can("create_client") ? <Link href="/clients/new" className="btn-primary btn-sm"><UserPlus className="h-4 w-4" /> Add New Client</Link> : undefined} />}
        </div>
      </Card>
      {needAttention.length > 0 && (
        <Card title="Clients needing attention" className="mt-4">
          <div className="flex flex-wrap gap-2">
            {needAttention.map((c) => (
              <Link key={c.id} href={`/clients/${c.id}`} className="inline-flex items-center gap-2 rounded-xl border border-ink-200 px-3 py-1.5 text-sm hover:border-brand-300">
                <MapPin className="h-3.5 w-3.5 text-ink-400" />{c.name}<Badge tone={SUPPORT_HEALTH[c.supportHealth].tone}>{SUPPORT_HEALTH[c.supportHealth].label}</Badge>
              </Link>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
