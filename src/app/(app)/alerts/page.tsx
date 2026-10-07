import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { Badge, Card, EmptyState, PageHeader, severityTone, timeAgo } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { alertAction } from "@/app/actions/ops";
import { cn } from "@/lib/utils";

export const metadata = { title: "Alerts" };

export default async function AlertsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireStaff();
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const status = sp.status ?? "open";
  const alerts = await db.alert.findMany({ where: { ...scope, ...(status === "open" ? { status: { not: "RESOLVED" } } : status === "resolved" ? { status: "RESOLVED" } : {}) }, orderBy: [{ severity: "asc" }, { createdAt: "desc" }], take: 300, include: { client: { select: { id: true, name: true } } } });
  // Smart grouping: low/medium alerts of the same type are collapsed so staff aren't overwhelmed.
  const critical = alerts.filter((a) => a.severity === "CRITICAL" || a.severity === "HIGH");
  const grouped = new Map<string, typeof alerts>();
  for (const a of alerts.filter((x) => x.severity === "MEDIUM" || x.severity === "LOW")) grouped.set(a.type, [...(grouped.get(a.type) ?? []), a]);
  return (
    <>
      <PageHeader title="Alerts" subtitle="Critical alerts escalate immediately; low-priority alerts are grouped" />
      <div className="mb-4 flex gap-2">{[["open", "Open"], ["resolved", "Resolved"], ["all", "All"]].map(([k, l]) => <Link key={k} href={`?status=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", status === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>{l}</Link>)}</div>
      <div className="grid gap-5 lg:grid-cols-3">
        <Card title="Critical & high" className="lg:col-span-2" pad={false}>
          <ul className="divide-y divide-ink-100">
            {critical.map((a) => (
              <li key={a.id} className="flex flex-wrap items-start gap-3 px-5 py-3">
                <Badge tone={severityTone(a.severity)}>{a.severity.toLowerCase()}</Badge>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">{a.title}</div>
                  {a.detail && <p className="whitespace-pre-wrap text-xs text-ink-500">{a.detail}</p>}
                  <div className="text-[11px] text-ink-400">{a.client ? <Link href={`/clients/${a.client.id}`} className="hover:text-brand-700">{a.client.name}</Link> : "Agency"} · {a.type.replace(/_/g, " ")} · {timeAgo(a.createdAt)} · {a.status.toLowerCase()}</div>
                </div>
                {a.status !== "RESOLVED" && (
                  <span className="flex gap-1">
                    {a.status === "OPEN" && <ActionButton action={alertAction.bind(null, a.id, "ACKNOWLEDGED")} className="btn-ghost btn-sm">Acknowledge</ActionButton>}
                    <ActionButton action={alertAction.bind(null, a.id, "RESOLVED")}>Mark resolved</ActionButton>
                  </span>
                )}
              </li>
            ))}
          </ul>
          {!critical.length && <EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="No critical alerts" />}
        </Card>
        <Card title="Grouped (medium & low)" pad={false}>
          <ul className="divide-y divide-ink-100">
            {[...grouped.entries()].map(([type, list]) => (
              <li key={type} className="px-5 py-3">
                <details>
                  <summary className="flex cursor-pointer items-center justify-between text-sm"><span className="capitalize">{type.replace(/_/g, " ")}</span><Badge>{list.length}</Badge></summary>
                  <ul className="mt-2 space-y-1.5">{list.map((a) => <li key={a.id} className="flex items-center gap-2 text-xs"><span className="flex-1">{a.client?.name}: {a.title}</span>{a.status !== "RESOLVED" && <ActionButton action={alertAction.bind(null, a.id, "RESOLVED")} className="btn-ghost btn-sm">Resolve</ActionButton>}</li>)}</ul>
                </details>
              </li>
            ))}
          </ul>
          {!grouped.size && <EmptyState title="Nothing grouped" />}
        </Card>
      </div>
    </>
  );
}
