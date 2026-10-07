import Link from "next/link";
import { redirect } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import type { ApprovalCategory, Prisma } from "@prisma/client";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { Card, EmptyState, PageHeader } from "@/components/ui";
import { ActionButton } from "@/components/client";
import { ApprovalCard } from "@/components/approval-card";
import { approveAllSafeAction } from "@/app/actions/ops";
import { cn } from "@/lib/utils";

export const metadata = { title: "Approval Center" };
const CATS: ApprovalCategory[] = ["GBP", "WEBSITE", "CONTENT", "REVIEWS", "IMAGES", "TECHNICAL"];

export default async function ApprovalsPage({ searchParams }: { searchParams: Promise<{ category?: string; client?: string; risk?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("approve_content") && !ctx.can("view_all_clients")) redirect("/dashboard");
  const sp = await searchParams;
  const scope = await clientScopeFilter(ctx);
  const where: Prisma.ApprovalWhereInput = { ...scope, status: "PENDING" };
  if (sp.category && CATS.includes(sp.category as ApprovalCategory)) where.category = sp.category as ApprovalCategory;
  if (sp.client) where.clientId = sp.client;
  if (sp.risk) where.risk = sp.risk as "LOW";
  const [approvals, counts, clients] = await Promise.all([
    db.approval.findMany({ where, orderBy: [{ risk: "desc" }, { createdAt: "asc" }], take: 60, include: { client: { select: { name: true } }, recommendation: { select: { sourceSignals: true, action: true } } } }),
    db.approval.groupBy({ by: ["category"], where: { ...scope, status: "PENDING", ...(sp.client ? { clientId: sp.client } : {}) }, _count: true }),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const total = counts.reduce((s, c) => s + c._count, 0);
  const q = (extra: Record<string, string>) => `/approvals?${new URLSearchParams({ ...(sp.client ? { client: sp.client } : {}), ...extra })}`;
  return (
    <>
      <PageHeader title="Approval Center" subtitle="Everything the AI prepared that needs a human decision" actions={ctx.can("approve_content") && <ActionButton action={approveAllSafeAction.bind(null, sp.client)} className="btn-primary" confirm="Approve every pending LOW-risk, auto-safe action in this view?">Approve All Safe Actions</ActionButton>} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Link href={q({})} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", !sp.category ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>All ({total})</Link>
        {CATS.map((c) => <Link key={c} href={q({ category: c })} className={cn("rounded-full px-3 py-1.5 text-xs ring-1 ring-inset", sp.category === c ? "bg-brand-600 text-white ring-brand-600" : "bg-white ring-ink-200")}>{c.charAt(0) + c.slice(1).toLowerCase()} ({counts.find((x) => x.category === c)?._count ?? 0})</Link>)}
        <form className="ml-auto flex gap-2">
          {sp.category && <input type="hidden" name="category" value={sp.category} />}
          <select name="client" defaultValue={sp.client ?? ""} className="input h-8 w-auto py-1 text-xs"><option value="">All clients</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
          <select name="risk" defaultValue={sp.risk ?? ""} className="input h-8 w-auto py-1 text-xs"><option value="">Any risk</option>{["LOW", "MEDIUM", "HIGH", "CRITICAL"].map((r) => <option key={r} value={r}>{r.toLowerCase()}</option>)}</select>
          <button className="btn-secondary btn-sm">Filter</button>
        </form>
      </div>
      <div className="space-y-4">
        {approvals.map((a) => <ApprovalCard key={a.id} a={a} clientName={a.client.name} canDecide={ctx.can("approve_content")} />)}
        {!approvals.length && <Card><EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="Nothing waiting for approval" description="Safe actions are running automatically." /></Card>}
      </div>
    </>
  );
}
