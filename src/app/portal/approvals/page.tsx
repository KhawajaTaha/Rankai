import { CheckCircle2 } from "lucide-react";
import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, EmptyState, PageHeader, timeAgo } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { portalDecideAction } from "@/app/actions/portal";

export const metadata = { title: "Approvals" };

export default async function PortalApprovals() {
  const ctx = await requirePortal();
  const items = await db.approval.findMany({ where: { clientId: ctx.portalClientId, status: "PENDING", requiresClient: true }, orderBy: { createdAt: "asc" } });
  return (
    <>
      <PageHeader title={items.length ? `${items.length} item${items.length > 1 ? "s" : ""} need your approval` : "Approvals"} subtitle="Review what we'd like to change. Nothing is published without your OK." />
      <div className="space-y-4">
        {items.map((a) => (
          <div key={a.id} className="card p-5">
            <div className="flex items-center justify-between"><h2 className="text-base font-semibold">{a.title}</h2><span className="text-xs text-ink-400">{timeAgo(a.createdAt)}</span></div>
            {a.reason && <p className="mt-1 text-sm text-ink-600"><b>Why:</b> {a.reason}</p>}
            <div className="mt-3 grid gap-3 md:grid-cols-2">
              <div><div className="label">Current</div><div className="whitespace-pre-wrap rounded-xl bg-ink-50 p-3 text-sm text-ink-700">{a.beforeValue ?? "—"}</div></div>
              <div><div className="label">Recommended</div><div className="whitespace-pre-wrap rounded-xl bg-brand-50/60 p-3 text-sm text-ink-800">{a.afterValue ?? "—"}</div></div>
            </div>
            {ctx.can("portal_approve") && (
              <ActionForm action={portalDecideAction.bind(null, a.id)} className="mt-4 flex flex-wrap items-center gap-2">
                <input name="note" placeholder="Comments (optional)" className="input h-9 max-w-sm" />
                <SubmitButton className="btn-primary" name="decision" value="APPROVED">Approve</SubmitButton>
                <SubmitButton className="btn-secondary" name="decision" value="CHANGES_REQUESTED">Request Changes</SubmitButton>
                <SubmitButton className="btn-ghost text-red-600" name="decision" value="REJECTED">Reject</SubmitButton>
              </ActionForm>
            )}
          </div>
        ))}
        {!items.length && <Card><EmptyState icon={<CheckCircle2 className="h-5 w-5" />} title="You're all caught up" description="We'll let you know when something needs your input." /></Card>}
      </div>
    </>
  );
}
