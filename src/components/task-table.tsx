import Link from "next/link";
import type { Task, TaskComment } from "@prisma/client";
import { Badge, EmptyState, fmtDate, severityTone } from "./ui";
import { ActionForm, SubmitButton } from "./client";
import { TaskStatusSelect } from "./task-status";
import { commentTaskAction } from "@/app/actions/ops";
import { pretty } from "@/lib/labels";

type Row = Task & { client: { id: string; name: string } | null; comments: TaskComment[]; dependsOn: { title: string; status: string } | null };

export function TaskTable({ tasks, names, showClient = true, openId }: { tasks: Row[]; names: Map<string, { name: string }>; showClient?: boolean; openId?: string }) {
  if (!tasks.length) return <EmptyState title="No tasks" description="Tasks created by people, AI, automations, client requests, audits and review alerts appear here." />;
  return (
    <ul className="divide-y divide-ink-100">
      {tasks.map((t) => {
        const overdue = t.dueAt && t.dueAt < new Date() && !["COMPLETED", "CANCELLED"].includes(t.status);
        return (
          <li key={t.id} id={t.id} className="px-5 py-3">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <div className={`text-sm font-medium ${t.status === "COMPLETED" ? "text-ink-400 line-through" : "text-ink-900"}`}>{t.title}</div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-500">
                  {showClient && t.client && <Link href={`/clients/${t.client.id}/tasks`} className="hover:text-brand-700">{t.client.name}</Link>}
                  <Badge>{t.category}</Badge>
                  <Badge tone={severityTone(t.priority)}>{t.priority.toLowerCase()}</Badge>
                  <Badge tone={t.source === "HUMAN" ? "gray" : "purple"}>{pretty(t.source)}</Badge>
                  <span>· {t.assignedToId ? names.get(t.assignedToId)?.name ?? "—" : "Unassigned"}</span>
                  <span className={overdue ? "font-medium text-red-600" : ""}>· due {fmtDate(t.dueAt, true)}</span>
                  {t.dependsOn && <span className="text-amber-700">· depends on “{t.dependsOn.title}” ({t.dependsOn.status.toLowerCase()})</span>}
                </div>
              </div>
              <TaskStatusSelect id={t.id} status={t.status} />
            </div>
            <details className="mt-1" open={openId === t.id}>
              <summary className="cursor-pointer text-[11px] text-ink-400">{t.description ? "Details" : ""}{t.comments.length ? ` · ${t.comments.length} comment(s)` : " · Comment"}</summary>
              {t.description && <p className="mt-2 whitespace-pre-wrap rounded-lg bg-ink-50 p-2.5 text-xs text-ink-700">{t.description}</p>}
              <ul className="mt-2 space-y-1.5">{t.comments.map((c) => <li key={c.id} className="text-xs"><span className="font-medium">{names.get(c.authorId)?.name ?? "—"}:</span> {c.body} <span className="text-ink-400">{fmtDate(c.createdAt, true)}</span></li>)}</ul>
              <ActionForm action={commentTaskAction.bind(null, t.id)} className="mt-2 flex gap-2" hideMessage>
                <input name="body" className="input h-8 text-xs" placeholder="Comment — @mention teammates" />
                <SubmitButton className="btn-secondary btn-sm">Post</SubmitButton>
              </ActionForm>
            </details>
          </li>
        );
      })}
    </ul>
  );
}
