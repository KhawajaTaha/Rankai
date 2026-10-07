import Link from "next/link";
import { ExternalLink, Globe, MapPin, Phone } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { clientAssignmentsMap } from "@/lib/queries";
import { LEVEL_LABEL, STAGE_LABEL, SUPPORT_HEALTH } from "@/lib/labels";
import { Avatar, Badge, DemoBadge, ScoreRing, StatusBadge, fmtDate, timeAgo } from "@/components/ui";
import { ClientTabs } from "./tabs";
import { QuickActions } from "./quick-actions";
import { quickJobAction, setAutomationPausedAction } from "@/app/actions/clients";

export default async function ClientLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const client = await getAccessibleClient(ctx, id);
  const [full, assigned, members, counts] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id }, include: { automation: { select: { level: true } }, knowledge: { select: { services: true } }, locations: { include: { account: { include: { connection: true } } }, take: 1 }, integrations: true, package: true } }),
    clientAssignmentsMap([id]),
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { isClientRole: false } }, include: { user: true } }),
    Promise.all([
      db.approval.count({ where: { clientId: id, status: "PENDING" } }),
      db.task.count({ where: { clientId: id, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
      db.gbpReview.count({ where: { clientId: id, replyStatus: { in: ["UNANSWERED", "DRAFTED", "NEEDS_APPROVAL"] } } }),
      db.supportTicket.count({ where: { clientId: id, status: { in: ["OPEN", "IN_PROGRESS"] } } }),
    ]),
  ]);
  const a = assigned.get(id) ?? {};
  const loc = full.locations[0];
  const website = full.integrations.find((i) => i.kind.startsWith("WEBSITE"));
  const sh = SUPPORT_HEALTH[client.supportHealth];
  const perms = Object.fromEntries(["add_calls", "add_notes", "create_tasks", "create_content", "run_audit", "manage_keywords", "generate_reports", "pause_automation"].map((p) => [p, ctx.can(p as never)]));
  const anyDemo = loc?.account.connection.mode === "DEMO" || full.integrations.some((i) => i.mode === "DEMO");

  return (
    <div>
      <div className="card mb-5 p-5">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-start">
          <div className="flex min-w-0 flex-1 items-start gap-4">
            <Avatar name={client.name} src={client.logoUrl} size={56} square />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-xl font-semibold tracking-tight">{client.name}</h1>
                <Badge tone={sh.tone}>{sh.label}</Badge>
                {client.status === "ONBOARDING" && <Badge tone="blue">{STAGE_LABEL[client.onboardingStage]}</Badge>}
                {client.automationPaused && <StatusBadge status="PAUSED" label="Automation paused" />}
                {anyDemo && <DemoBadge />}
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-500">
                {client.address && <span className="inline-flex items-center gap-1"><MapPin className="h-3.5 w-3.5" />{client.address}{client.city ? `, ${client.city}` : ""}</span>}
                {client.phone && <a href={`tel:${client.phone}`} className="inline-flex items-center gap-1 hover:text-brand-700"><Phone className="h-3.5 w-3.5" />{client.phone}</a>}
                {client.website && <a href={client.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 hover:text-brand-700"><Globe className="h-3.5 w-3.5" />{client.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "")}<ExternalLink className="h-3 w-3" /></a>}
              </div>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1.5 text-xs">
                <span><span className="text-ink-400">GBP:</span> {loc ? <StatusBadge status={loc.account.connection.status} /> : <Link href={`/clients/${id}/gbp`} className="link">Connect</Link>}</span>
                <span><span className="text-ink-400">Website:</span> {website ? <StatusBadge status={website.status} /> : <Link href={`/clients/${id}/website`} className="link">Connect</Link>}</span>
                <span><span className="text-ink-400">SEO:</span> {a.seo ?? "—"}</span>
                <span><span className="text-ink-400">Support:</span> {a.support ?? "—"}</span>
                <span><span className="text-ink-400">Last contact:</span> {timeAgo(client.lastContactAt)}</span>
                <span><span className="text-ink-400">Next follow-up:</span> <span className={client.nextFollowUpAt && client.nextFollowUpAt < new Date() ? "font-medium text-red-600" : ""}>{fmtDate(client.nextFollowUpAt)}</span></span>
                <span><span className="text-ink-400">Automation:</span> {LEVEL_LABEL[full.automation?.level ?? "ASSIST"]}</span>
                <span><span className="text-ink-400">Package:</span> {full.package?.name ?? "—"}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-4">
            <div className="text-center"><ScoreRing score={client.healthScore} size={58} /><div className="mt-1 text-[11px] text-ink-500">Health</div></div>
            <div className="text-center"><ScoreRing score={client.gbpScore} size={58} /><div className="mt-1 text-[11px] text-ink-500">GBP</div></div>
            <div className="text-center"><ScoreRing score={client.seoScore} size={58} /><div className="mt-1 text-[11px] text-ink-500">SEO Health</div></div>
          </div>
        </div>
        <div className="mt-4 border-t border-ink-100 pt-4">
          <QuickActions
            clientId={id}
            services={full.knowledge?.services ?? []}
            members={members.map((m) => ({ id: m.id, name: m.user.name }))}
            perms={perms}
            paused={client.automationPaused}
            jobs={{ gbpAudit: quickJobAction.bind(null, id, "gbp_audit"), websiteAudit: quickJobAction.bind(null, id, "website_audit"), ranks: quickJobAction.bind(null, id, "ranks"), report: quickJobAction.bind(null, id, "report") }}
            togglePause={setAutomationPausedAction.bind(null, id, !client.automationPaused)}
          />
        </div>
      </div>
      <ClientTabs id={id} counts={{ approvals: counts[0], tasks: counts[1], reviews: counts[2], support: counts[3] }} />
      <div className="mt-5">{children}</div>
    </div>
  );
}
