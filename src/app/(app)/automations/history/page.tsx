import Link from "next/link";
import { redirect } from "next/navigation";
import type { Prisma } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { HANDLERS } from "@/lib/jobs/handlers";
import { Card, EmptyState, PageHeader, StatusBadge, Tabs, fmtDate } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { runControlAction } from "@/app/actions/ops";
import { setAutomationPausedAction } from "@/app/actions/clients";
import { cn } from "@/lib/utils";

export const metadata = { title: "Execution History" };

export default async function HistoryPage({ searchParams }: { searchParams: Promise<{ status?: string; client?: string; type?: string; run?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("view_command_center")) redirect("/dashboard");
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const where: Prisma.AutomationRunWhereInput = { ...scope };
  if (sp.status === "failed") where.status = { in: ["FAILED", "NEEDS_HUMAN"] };
  else if (sp.status === "queued") where.status = { in: ["QUEUED", "RETRYING"] };
  else if (sp.status === "running") where.status = "RUNNING";
  else if (sp.status === "succeeded") where.status = "SUCCEEDED";
  if (sp.client) where.clientId = sp.client;
  if (sp.type) where.type = sp.type;
  if (sp.run) where.id = sp.run;
  const runs = await db.automationRun.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
  const clientNames = new Map((await db.client.findMany({ where: { id: { in: [...new Set(runs.map((r) => r.clientId).filter(Boolean) as string[])] } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]));
  return (
    <>
      <PageHeader title="Execution History" subtitle="Every automation run with retries, errors and human controls" />
      <Tabs active="/automations/history" tabs={[{ href: "/automations", label: "Overview" }, { href: "/automations/history", label: "Execution History" }]} />
      <div className="my-4 flex flex-wrap gap-2">
        {[["", "All"], ["running", "Running"], ["queued", "Queued / retrying"], ["failed", "Failed / requires human"], ["succeeded", "Completed"]].map(([k, l]) => <Link key={k} href={`/automations/history${k ? `?status=${k}` : ""}`} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", (sp.status ?? "") === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>{l}</Link>)}
        <form className="ml-auto"><select name="type" defaultValue={sp.type ?? ""} className="input h-8 w-auto py-1 text-xs"><option value="">Any automation</option>{Object.entries(HANDLERS).map(([k, h]) => <option key={k} value={k}>{h.label}</option>)}</select> <button className="btn-secondary btn-sm">Filter</button></form>
      </div>
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1000px]">
            <thead className="bg-ink-50/60"><tr>{["Client", "Automation", "Action", "Status", "Attempts", "Started", "Completed", "Error", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id} className="tr align-top text-xs">
                  <td className="td">{r.clientId ? <Link href={`/clients/${r.clientId}`} className="hover:text-brand-700">{clientNames.get(r.clientId)}</Link> : "Agency"}</td>
                  <td className="td">{HANDLERS[r.type]?.label ?? r.type}<div className="text-[10px] text-ink-400">{r.triggeredBy.toLowerCase()}</div></td>
                  <td className="td max-w-[220px] truncate">{r.label}</td>
                  <td className="td"><StatusBadge status={r.status} label={r.status === "NEEDS_HUMAN" ? "Requires human" : undefined} /></td>
                  <td className="td">{r.attempts}/{r.maxAttempts}</td>
                  <td className="td whitespace-nowrap">{fmtDate(r.startedAt ?? r.runAt, true)}</td>
                  <td className="td whitespace-nowrap">{fmtDate(r.completedAt, true)}</td>
                  <td className="td max-w-[280px]">{r.lastError && <details><summary className="cursor-pointer truncate text-red-600">{r.lastError}</summary><pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-2 text-[10px]">{r.errorDetail}</pre></details>}</td>
                  <td className="td whitespace-nowrap">
                    {["FAILED", "NEEDS_HUMAN", "CANCELLED"].includes(r.status) && <ActionButton action={runControlAction.bind(null, r.id, "retry")}>Retry</ActionButton>}
                    {["QUEUED", "RETRYING"].includes(r.status) && <ActionButton action={runControlAction.bind(null, r.id, "cancel")} className="btn-ghost btn-sm">Cancel</ActionButton>}
                    {r.clientId && ["FAILED", "NEEDS_HUMAN"].includes(r.status) && ctx.can("pause_automation") && <ActionButton action={setAutomationPausedAction.bind(null, r.clientId, true)} className="btn-ghost btn-sm" confirm="Pause all automation for this client?">Pause client</ActionButton>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!runs.length && <EmptyState title="No runs match" />}
        </div>
      </Card>
    </>
  );
}
