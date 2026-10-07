import Link from "next/link";
import type { Approval } from "@prisma/client";
import { Badge, severityTone, timeAgo } from "./ui";
import { ActionForm, SubmitButton } from "./client";
import { decideApprovalAction } from "@/app/actions/ops";
import { pretty } from "@/lib/labels";

export function ApprovalCard({ a, clientName, canDecide }: { a: Approval & { recommendation?: { sourceSignals: string[]; action: string } | null }; clientName?: string; canDecide: boolean }) {
  return (
    <div className="card p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-ink-900">{a.title}</span>
        <Badge tone="blue">{pretty(a.category)}</Badge>
        <Badge tone={severityTone(a.risk)}>{a.risk.toLowerCase()} risk</Badge>
        {a.confidence != null && <Badge>{Math.round(a.confidence * 100)}% confidence</Badge>}
        {a.requiresClient && <Badge tone="purple">client approval</Badge>}
        <span className="ml-auto text-xs text-ink-400">{clientName && <Link href={`/clients/${a.clientId}`} className="hover:text-brand-700">{clientName} · </Link>}{timeAgo(a.createdAt)}</span>
      </div>
      {(a.reason || a.description) && <p className="mt-1.5 text-xs text-ink-600">{a.reason}{a.description ? <span className="text-ink-400"> · {a.description}</span> : null}</p>}
      {a.recommendation?.sourceSignals.length ? <p className="mt-1 text-[11px] text-ink-400">Evidence: {a.recommendation.sourceSignals.join(", ")}</p> : null}
      {a.contentItemId && <Link href={`/content/${a.contentItemId}`} className="link mt-1 inline-block text-xs">Open full preview</Link>}
      <ActionForm action={decideApprovalAction.bind(null, a.id)} className="mt-3">
        <div className="grid gap-3 md:grid-cols-2">
          <div><div className="label">Before</div><div className="max-h-48 overflow-auto whitespace-pre-wrap rounded-xl bg-red-50/50 p-3 text-xs text-ink-700">{a.beforeValue ?? "—"}</div></div>
          <div><div className="label">After (editable)</div><textarea name="edited" defaultValue={a.afterValue ?? ""} rows={6} className="input text-xs" disabled={!canDecide} /></div>
        </div>
        {canDecide && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <input name="note" placeholder="Note (optional, @mention supported)" className="input h-8 max-w-xs text-xs" />
            <input name="scheduleFor" type="datetime-local" className="input h-8 w-auto text-xs" title="Schedule execution" />
            <SubmitButton className="btn-primary btn-sm" name="decision" value="APPROVED">Approve</SubmitButton>
            <SubmitButton className="btn-secondary btn-sm" name="decision" value="CHANGES_REQUESTED">Request changes</SubmitButton>
            <SubmitButton className="btn-ghost btn-sm text-red-600" name="decision" value="REJECTED">Reject</SubmitButton>
          </div>
        )}
      </ActionForm>
    </div>
  );
}
