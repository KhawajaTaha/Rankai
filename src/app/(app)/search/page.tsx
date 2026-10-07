import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter, clientWhere } from "@/lib/tenancy";
import { Card, EmptyState, PageHeader, timeAgo } from "@/components/ui";

export const metadata = { title: "Search" };

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireStaff();
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  if (q.length < 2) return <><PageHeader title="Search" /><Card><EmptyState title="Type at least 2 characters" /></Card></>;
  const scope = await clientScopeFilter(ctx);
  const c = { contains: q, mode: "insensitive" as const };
  const [clients, contacts, calls, notes, tasks, keywords, pages, reviews, posts, reports, tickets] = await Promise.all([
    db.client.findMany({ where: clientWhere(ctx, { OR: [{ name: c }, { city: c }, { website: c }, { phone: c }] }), take: 10 }),
    db.clientContact.findMany({ where: { ...scope, OR: [{ name: c }, { email: c }, { phone: c }] }, take: 10, include: { client: { select: { name: true } } } }),
    db.supportCall.findMany({ where: { ...scope, OR: [{ purpose: c }, { discussion: c }, { result: c }, { contactName: c }] }, take: 10, include: { client: { select: { name: true } } } }),
    db.supportNote.findMany({ where: { ...scope, body: c }, take: 10, include: { client: { select: { name: true } } } }),
    db.task.findMany({ where: { organizationId: ctx.orgId, ...(scope.clientId ? { clientId: scope.clientId } : {}), OR: [{ title: c }, { description: c }] }, take: 10 }),
    db.keyword.findMany({ where: { ...scope, phrase: c }, take: 10, include: { client: { select: { name: true } } } }),
    db.websitePage.findMany({ where: { ...scope, OR: [{ url: c }, { title: c }] }, take: 10 }),
    db.gbpReview.findMany({ where: { ...scope, OR: [{ comment: c }, { reviewerName: c }] }, take: 10, include: { client: { select: { name: true } } } }),
    db.contentItem.findMany({ where: { ...scope, OR: [{ title: c }, { body: c }] }, take: 10 }),
    db.report.findMany({ where: { ...scope, title: c }, take: 10 }),
    db.supportTicket.findMany({ where: { ...scope, OR: [{ subject: c }, { description: c }] }, take: 10 }),
  ]);
  const groups: { title: string; items: { href: string; label: string; sub?: string }[] }[] = [
    { title: "Clients", items: clients.map((x) => ({ href: `/clients/${x.id}`, label: x.name, sub: x.city ?? "" })) },
    { title: "Contacts", items: contacts.map((x) => ({ href: `/clients/${x.clientId}/support`, label: x.name, sub: `${x.client.name} · ${x.email ?? x.phone ?? ""}` })) },
    { title: "Calls", items: calls.map((x) => ({ href: `/clients/${x.clientId}/support?tab=calls`, label: x.purpose ?? "Call", sub: `${x.client.name} · ${timeAgo(x.occurredAt)}` })) },
    { title: "Notes", items: notes.map((x) => ({ href: `/clients/${x.clientId}/support?tab=notes`, label: x.body.slice(0, 90), sub: x.client.name })) },
    { title: "Tasks", items: tasks.map((x) => ({ href: `/tasks?task=${x.id}`, label: x.title, sub: x.status.toLowerCase() })) },
    { title: "Keywords", items: keywords.map((x) => ({ href: `/clients/${x.clientId}/rankings`, label: x.phrase, sub: `${x.client.name} · position ${x.currentPosition ?? "—"}` })) },
    { title: "Pages", items: pages.map((x) => ({ href: `/clients/${x.clientId}/website?tab=pages`, label: x.title ?? x.url, sub: x.url })) },
    { title: "Reviews", items: reviews.map((x) => ({ href: `/clients/${x.clientId}/reviews`, label: `${x.rating}★ ${x.reviewerName}`, sub: `${x.client.name} · ${(x.comment ?? "").slice(0, 60)}` })) },
    { title: "Posts & content", items: posts.map((x) => ({ href: `/content/${x.id}`, label: x.title, sub: x.type.toLowerCase() })) },
    { title: "Reports", items: reports.map((x) => ({ href: `/reports/${x.id}`, label: x.title })) },
    { title: "Tickets", items: tickets.map((x) => ({ href: `/support/tickets/${x.id}`, label: `#${x.number} ${x.subject}` })) },
  ].filter((g) => g.items.length);
  return (
    <>
      <PageHeader title={`Search: “${q}”`} subtitle={`${groups.reduce((s, g) => s + g.items.length, 0)} results`} />
      {groups.length ? (
        <div className="grid gap-4 md:grid-cols-2">
          {groups.map((g) => (
            <Card key={g.title} title={g.title} pad={false}>
              <ul className="divide-y divide-ink-100">{g.items.map((i, k) => <li key={k} className="px-5 py-2.5"><Link href={i.href} className="block truncate text-sm font-medium hover:text-brand-700">{i.label}</Link>{i.sub && <div className="truncate text-xs text-ink-500">{i.sub}</div>}</li>)}</ul>
            </Card>
          ))}
        </div>
      ) : <Card><EmptyState title="No results" /></Card>}
    </>
  );
}
