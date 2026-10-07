import Link from "next/link";
import { Pin } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Badge, Card, EmptyState, PageHeader, timeAgo } from "@/components/ui";
import { Dialog } from "@/components/client";
import { NoteForm } from "@/components/forms";
import { SupportNav } from "@/components/support-nav";

export const metadata = { title: "Notes" };

export default async function NotesPage() {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const [notes, names, clients] = await Promise.all([
    db.supportNote.findMany({ where: { ...scope, ...(ctx.experience === "support" ? { createdById: ctx.memberId } : {}) }, orderBy: { createdAt: "desc" }, take: 200, include: { client: { select: { id: true, name: true } } } }),
    memberNames(ctx.orgId),
    db.client.findMany({ where: clientWhere(ctx), select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <>
      <PageHeader title="Notes" actions={ctx.can("add_notes") && <Dialog trigger="+ Add Note" title="Add a note" triggerClassName="btn-primary" wide><NoteForm clients={clients} /></Dialog>} />
      {ctx.experience !== "support" && <SupportNav active="/support/notes" manager={ctx.can("view_support_performance")} />}
      <Card pad={false}>
        <ul className="divide-y divide-ink-100">
          {notes.map((n) => (
            <li key={n.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {n.pinned && <Pin className="h-3.5 w-3.5 text-amber-500" />}
                <Link href={`/clients/${n.clientId}/support?tab=notes`} className="font-medium text-ink-800 hover:text-brand-700">{n.client.name}</Link>
                <Badge>{n.category}</Badge>{n.useAsAiContext && <Badge tone="purple">AI context</Badge>}<Badge tone={n.visibility === "INTERNAL" ? "gray" : "teal"}>{n.visibility === "INTERNAL" ? "internal" : "client visible"}</Badge>
                <span className="ml-auto text-ink-400">{names.get(n.createdById)?.name} · {timeAgo(n.createdAt)}</span>
              </div>
              <p className="mt-1 text-sm text-ink-700">{n.body}</p>
            </li>
          ))}
        </ul>
        {!notes.length && <EmptyState title="No notes yet" />}
      </Card>
    </>
  );
}
