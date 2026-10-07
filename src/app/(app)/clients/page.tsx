import Link from "next/link";
import { Plus, Users } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientWhere } from "@/lib/tenancy";
import { clientAssignmentsMap } from "@/lib/queries";
import { SUPPORT_HEALTH, STAGE_LABEL, LEVEL_LABEL } from "@/lib/labels";
import { Avatar, Badge, Card, EmptyState, PageHeader, ScoreRing, StatusBadge, timeAgo } from "@/components/ui";
import { ActionForm, BulkSelect, SubmitButton } from "@/components/client";
import { bulkAction } from "@/app/actions/clients";
import { cn } from "@/lib/utils";

export const metadata = { title: "Clients" };

const FILTERS = [
  { key: "all", label: "All" },
  { key: "active", label: "Active" },
  { key: "onboarding", label: "Onboarding" },
  { key: "attention", label: "Needs attention" },
  { key: "paused", label: "Automation paused" },
];

export default async function ClientsPage({ searchParams }: { searchParams: Promise<{ filter?: string; q?: string; agent?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const extra: Prisma.ClientWhereInput = {};
  if (sp.filter === "active") extra.status = "ACTIVE";
  if (sp.filter === "onboarding") extra.status = "ONBOARDING";
  if (sp.filter === "attention") extra.supportHealth = { in: ["URGENT", "NEEDS_FOLLOW_UP", "SEO_ATTENTION_NEEDED"] };
  if (sp.filter === "paused") extra.automationPaused = true;
  if (sp.q) extra.name = { contains: sp.q, mode: "insensitive" };
  if (sp.agent) extra.assignments = { some: { memberId: sp.agent } };
  const clients = await db.client.findMany({
    where: clientWhere(ctx, extra),
    orderBy: { name: "asc" },
    include: { automation: { select: { level: true } }, package: { select: { name: true } }, locations: { select: { id: true, account: { select: { connection: { select: { status: true } } } } }, take: 1 }, _count: { select: { approvals: { where: { status: "PENDING" } }, tasks: { where: { status: { notIn: ["COMPLETED", "CANCELLED"] } } } } } },
  });
  const assigned = await clientAssignmentsMap(clients.map((c) => c.id));
  const team = ctx.can("bulk_operations") ? await db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE", role: { isClientRole: false } }, include: { user: true, role: true } }) : [];
  const canBulk = ctx.can("bulk_operations");

  return (
    <>
      <PageHeader
        title={ctx.experience === "support" ? "My Clients" : "Clients"}
        subtitle={`${clients.length} client${clients.length === 1 ? "" : "s"}${ctx.can("view_all_clients") ? "" : " assigned to you"}`}
        actions={ctx.can("create_client") && <Link href="/clients/new" className="btn-primary"><Plus className="h-4 w-4" /> Add New Client</Link>}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {FILTERS.map((f) => (
          <Link key={f.key} href={f.key === "all" ? "/clients" : `/clients?filter=${f.key}`} className={cn("rounded-full px-3 py-1.5 text-xs font-medium ring-1 ring-inset", (sp.filter ?? "all") === f.key ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-ink-600 ring-ink-200 hover:bg-ink-50")}>{f.label}</Link>
        ))}
        <form className="ml-auto"><input name="q" defaultValue={sp.q} placeholder="Filter by name…" className="input h-8 w-56" /></form>
      </div>
      <ActionForm action={bulkAction} resetOnSuccess={false}>
        {canBulk && (
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-2xl border border-ink-200 bg-white p-2.5">
            <span className="px-1 text-xs font-medium text-ink-500">Bulk:</span>
            <select name="op" className="input h-8 w-auto py-1 text-xs" defaultValue="">
              <option value="" disabled>Choose operation…</option>
              <option value="posts">Generate & schedule GBP posts</option>
              <option value="audits">Run audits</option>
              <option value="reports">Generate reports</option>
              <option value="ranks">Check rankings</option>
              <option value="assign_support">Assign support agent</option>
              <option value="assign_seo">Assign SEO specialist</option>
              <option value="onboarding_reminders">Send onboarding reminders</option>
              <option value="reconnect_alerts">Reconnect alerts</option>
              <option value="level">Change automation level</option>
              <option value="pause">Pause automation</option>
              <option value="resume">Resume automation</option>
            </select>
            <select name="memberId" className="input h-8 w-auto py-1 text-xs" defaultValue="">
              <option value="">Team member (for assign)…</option>
              {team.map((m) => <option key={m.id} value={m.id}>{m.user.name} — {m.role.name}</option>)}
            </select>
            <select name="level" className="input h-8 w-auto py-1 text-xs" defaultValue="">
              <option value="">Automation level…</option>
              {Object.entries(LEVEL_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <SubmitButton className="btn-primary btn-sm">Apply to selected</SubmitButton>
            <span className="text-[11px] text-ink-400">Bulk GBP identity edits are never allowed.</span>
          </div>
        )}
        <Card pad={false}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1000px]">
              <thead className="bg-ink-50/60">
                <tr>
                  {canBulk && <th className="th w-8"><BulkSelect /></th>}
                  {["Client", "Health", "GBP", "SEO", "Status", "Team", "Automation", "Open", "Last contact"].map((h) => <th key={h} className="th">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => {
                  const a = assigned.get(c.id);
                  const sh = SUPPORT_HEALTH[c.supportHealth];
                  return (
                    <tr key={c.id} className="tr">
                      {canBulk && <td className="td"><input type="checkbox" name="ids" value={c.id} className="h-4 w-4 rounded border-ink-300" /></td>}
                      <td className="td">
                        <Link href={`/clients/${c.id}`} className="flex items-center gap-3">
                          <Avatar name={c.name} src={c.logoUrl} size={34} square />
                          <span className="min-w-0">
                            <span className="block truncate font-medium text-ink-900 hover:text-brand-700">{c.name}</span>
                            <span className="block truncate text-xs text-ink-500">{c.city ?? "—"} · {c.package?.name ?? "No package"}</span>
                          </span>
                        </Link>
                      </td>
                      <td className="td"><ScoreRing score={c.healthScore} size={36} /></td>
                      <td className="td"><ScoreRing score={c.gbpScore} size={36} /></td>
                      <td className="td"><ScoreRing score={c.seoScore} size={36} /></td>
                      <td className="td">
                        <Badge tone={sh.tone}>{sh.label}</Badge>
                        {c.status === "ONBOARDING" && <div className="mt-1 text-[10px] text-ink-400">{STAGE_LABEL[c.onboardingStage]}</div>}
                      </td>
                      <td className="td text-xs"><div>{a?.support ? `Support: ${a.support}` : <span className="text-ink-400">No support agent</span>}</div><div className="text-ink-500">{a?.seo ? `SEO: ${a.seo}` : ""}</div></td>
                      <td className="td text-xs">{c.automationPaused ? <StatusBadge status="PAUSED" /> : <span>{LEVEL_LABEL[c.automation?.level ?? "ASSIST"]}</span>}</td>
                      <td className="td text-xs">{c._count.approvals > 0 && <Badge tone="amber">{c._count.approvals} approvals</Badge>} {c._count.tasks > 0 && <Badge>{c._count.tasks} tasks</Badge>}</td>
                      <td className="td text-xs text-ink-500">{timeAgo(c.lastContactAt)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!clients.length && <EmptyState icon={<Users className="h-5 w-5" />} title="No clients match" description="Try a different filter or add a new client." />}
          </div>
        </Card>
      </ActionForm>
    </>
  );
}
