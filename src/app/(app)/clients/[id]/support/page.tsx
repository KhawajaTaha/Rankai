import Link from "next/link";
import { Pin, Phone, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { getAccessibleClient } from "@/lib/tenancy";
import { memberNames } from "@/lib/queries";
import { Badge, Card, EmptyState, StatusBadge, Tabs, fmtDate, severityTone, timeAgo } from "@/components/ui";
import { ActionButton, Dialog } from "@/components/client";
import { CallForm, NoteForm } from "@/components/forms";
import { completeFollowUpAction, togglePinNoteAction } from "@/app/actions/clients";
import { pretty } from "@/lib/labels";

const SUB = ["overview", "calls", "notes", "follow-ups", "tasks", "emails", "requests", "activity"];

export default async function ClientSupport({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const sp = await searchParams;
  await getAccessibleClient(ctx, id);
  const tab = SUB.includes(sp.tab ?? "") ? sp.tab! : "overview";
  const base = `/clients/${id}/support`;
  const [calls, notes, followUps, tickets, tasks, activity, names, contacts] = await Promise.all([
    db.supportCall.findMany({ where: { clientId: id }, orderBy: { occurredAt: "desc" }, take: 100 }),
    db.supportNote.findMany({ where: { clientId: id }, orderBy: [{ pinned: "desc" }, { createdAt: "desc" }], take: 100 }),
    db.followUp.findMany({ where: { clientId: id }, orderBy: [{ completedAt: "asc" }, { dueAt: "asc" }], take: 100 }),
    db.supportTicket.findMany({ where: { clientId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.task.findMany({ where: { clientId: id, category: { in: ["Support", "Follow-Up", "Review", "Onboarding"] } }, orderBy: { createdAt: "desc" }, take: 50 }),
    db.activityLog.findMany({ where: { clientId: id, category: { in: ["SUPPORT", "CLIENT"] } }, orderBy: { createdAt: "desc" }, take: 60 }),
    memberNames(ctx.orgId),
    db.clientContact.findMany({ where: { clientId: id } }),
  ]);
  const who = (mid: string | null) => (mid ? names.get(mid)?.name ?? "—" : "—");
  const openFollow = followUps.filter((f) => !f.completedAt);

  const CallList = ({ limit }: { limit: number }) => (
    <ul className="divide-y divide-ink-100">
      {calls.slice(0, limit).map((c) => (
        <li key={c.id} className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-sm">
            {c.direction === "INCOMING" ? <PhoneIncoming className="h-4 w-4 text-emerald-500" /> : <PhoneOutgoing className="h-4 w-4 text-brand-500" />}
            <span className="font-medium">{c.purpose || "Call"}</span>
            <StatusBadge status={c.outcome === "ANSWERED" ? "COMPLETED" : "PENDING"} label={pretty(c.outcome)} />
            {c.durationMin != null && <span className="text-xs text-ink-500">{c.durationMin} min</span>}
            {c.tags.map((t) => <Badge key={t}>{t}</Badge>)}
            <span className="ml-auto text-xs text-ink-400">{fmtDate(c.occurredAt, true)} · {who(c.createdById)}</span>
          </div>
          {c.contactName && <div className="mt-0.5 text-xs text-ink-500">With {c.contactName}</div>}
          {c.discussion && <p className="mt-1 text-sm text-ink-700">{c.discussion}</p>}
          {c.result && <p className="mt-0.5 text-xs text-ink-500">Outcome: {c.result}</p>}
          {c.followUpRequired && <p className="mt-0.5 text-xs text-amber-700">Follow-up {fmtDate(c.followUpDate)}</p>}
        </li>
      ))}
      {!calls.length && <EmptyState icon={<Phone className="h-5 w-5" />} title="No calls logged" />}
    </ul>
  );
  const NoteList = ({ limit }: { limit: number }) => (
    <ul className="divide-y divide-ink-100">
      {notes.slice(0, limit).map((n) => (
        <li key={n.id} className="px-5 py-3">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {n.pinned && <Pin className="h-3.5 w-3.5 text-amber-500" />}
            <Badge>{n.category}</Badge>
            <Badge tone={severityTone(n.priority)}>{n.priority.toLowerCase()}</Badge>
            <Badge tone={n.visibility === "INTERNAL" ? "gray" : "teal"}>{n.visibility === "INTERNAL" ? "Internal only" : "Client visible"}</Badge>
            {n.useAsAiContext && <Badge tone="purple">AI context</Badge>}
            <span className="ml-auto text-ink-400">{who(n.createdById)} · {timeAgo(n.createdAt)}</span>
            {ctx.can("add_notes") && <ActionButton action={togglePinNoteAction.bind(null, n.id)} className="btn-ghost btn-sm">{n.pinned ? "Unpin" : "Pin"}</ActionButton>}
          </div>
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-ink-700">{n.body}</p>
          {n.attachmentUrl && <a href={n.attachmentUrl} className="link text-xs" target="_blank" rel="noreferrer">Attachment</a>}
        </li>
      ))}
      {!notes.length && <EmptyState title="No notes" />}
    </ul>
  );
  const FollowList = () => (
    <ul className="divide-y divide-ink-100">
      {followUps.map((f) => (
        <li key={f.id} className="flex items-center gap-3 px-5 py-3 text-sm">
          <div className="flex-1"><div className={f.completedAt ? "text-ink-400 line-through" : "font-medium"}>{f.title}</div><div className="text-xs text-ink-500">Due {fmtDate(f.dueAt, true)} · {who(f.assignedToId)}{f.escalatedAt ? " · escalated to manager" : f.remindedAt ? " · reminder sent" : ""}</div></div>
          {f.completedAt ? <StatusBadge status="COMPLETED" /> : <Badge tone={f.dueAt < new Date() ? "red" : "amber"}>{f.dueAt < new Date() ? "Overdue" : "Open"}</Badge>}
          {!f.completedAt && ctx.can("add_calls") && <ActionButton action={completeFollowUpAction.bind(null, f.id)}>Done</ActionButton>}
        </li>
      ))}
      {!followUps.length && <EmptyState title="No follow-ups" />}
    </ul>
  );
  const TicketList = () => (
    <ul className="divide-y divide-ink-100">
      {tickets.map((t) => (
        <li key={t.id} className="flex items-center gap-3 px-5 py-3 text-sm">
          <Link href={`/support/tickets/${t.id}`} className="flex-1 font-medium hover:text-brand-700">#{t.number} {t.subject}<div className="text-xs font-normal text-ink-500">{pretty(t.type)} · {t.requestedBy ?? "—"} · {timeAgo(t.createdAt)}</div></Link>
          <Badge tone={severityTone(t.priority)}>{t.priority.toLowerCase()}</Badge>
          <StatusBadge status={t.status} />
        </li>
      ))}
      {!tickets.length && <EmptyState title="No requests" />}
    </ul>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs active={`${base}?tab=${tab}`} tabs={SUB.map((s) => ({ href: `${base}?tab=${s}`, label: pretty(s.replace("-", " ")), count: s === "follow-ups" ? openFollow.length : s === "requests" ? tickets.filter((t) => ["OPEN", "IN_PROGRESS"].includes(t.status)).length : undefined }))} />
        <div className="flex gap-2">
          {ctx.can("add_calls") && <Dialog trigger="+ Add Call" title="Log a call" triggerClassName="btn-primary btn-sm" wide><CallForm clientId={id} /></Dialog>}
          {ctx.can("add_notes") && <Dialog trigger="+ Add Note" title="Add a note" triggerClassName="btn-secondary btn-sm" wide><NoteForm clientId={id} /></Dialog>}
        </div>
      </div>
      {tab === "overview" && (
        <div className="grid gap-5 lg:grid-cols-2">
          <Card title="Contacts" pad={false}>
            <ul className="divide-y divide-ink-100">{contacts.map((c) => <li key={c.id} className="px-5 py-2.5 text-sm"><span className="font-medium">{c.name}</span> {c.isPrimary && <Badge tone="blue">primary</Badge>}<div className="text-xs text-ink-500">{[c.role, c.phone, c.email].filter(Boolean).join(" · ")}</div></li>)}</ul>
          </Card>
          <Card title="Open follow-ups" pad={false}><FollowList /></Card>
          <Card title="Recent calls" pad={false} actions={<Link href={`${base}?tab=calls`} className="link text-xs">All</Link>}><CallList limit={4} /></Card>
          <Card title="Recent notes" pad={false} actions={<Link href={`${base}?tab=notes`} className="link text-xs">All</Link>}><NoteList limit={4} /></Card>
        </div>
      )}
      {tab === "calls" && <Card pad={false}><CallList limit={100} /></Card>}
      {tab === "notes" && <Card pad={false}><NoteList limit={100} /></Card>}
      {tab === "follow-ups" && <Card pad={false}><FollowList /></Card>}
      {tab === "requests" && <Card pad={false}><TicketList /></Card>}
      {tab === "tasks" && (
        <Card pad={false}><ul className="divide-y divide-ink-100">{tasks.map((t) => <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm"><span className="flex-1">{t.title}<div className="text-xs text-ink-500">{who(t.assignedToId)} · due {fmtDate(t.dueAt)}</div></span><StatusBadge status={t.status} /></li>)}</ul>{!tasks.length && <EmptyState title="No support tasks" />}</Card>
      )}
      {tab === "emails" && <Card><EmptyState title="Email integration" description="Email sync (Gmail / Outlook) is part of the Phase 5 integrations. Outbound report emails are logged in Activity." /></Card>}
      {tab === "activity" && <Card pad={false}><ul className="divide-y divide-ink-100">{activity.map((a) => <li key={a.id} className="px-5 py-2.5 text-sm">{a.title}<div className="text-xs text-ink-400">{a.actorName ?? a.actorType.toLowerCase()} · {fmtDate(a.createdAt, true)}</div></li>)}</ul></Card>}
    </div>
  );
}
