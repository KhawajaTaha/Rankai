import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { Card, PageHeader, fmtDate } from "@/components/ui";

export const metadata = { title: "Audit log" };

export default async function AuditLogPage({ searchParams }: { searchParams: Promise<{ action?: string; client?: string; page?: string }> }) {
  const ctx = await requireStaff();
  if (!ctx.can("view_audit_log")) redirect("/dashboard");
  const sp = await searchParams;
  const page = Math.max(0, Number(sp.page ?? 0));
  const where = { organizationId: ctx.orgId, ...(sp.action ? { action: { contains: sp.action } } : {}), ...(sp.client ? { clientId: sp.client } : {}) };
  const [logs, users, clients] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, take: 100, skip: page * 100 }),
    db.user.findMany({ where: { memberships: { some: { organizationId: ctx.orgId } } }, select: { id: true, name: true } }),
    db.client.findMany({ where: { organizationId: ctx.orgId }, select: { id: true, name: true } }),
  ]);
  const u = new Map(users.map((x) => [x.id, x.name]));
  const c = new Map(clients.map((x) => [x.id, x.name]));
  return (
    <>
      <PageHeader title="Audit log" subtitle="Immutable record of every change: who, what, client, old/new value, source, AI or human, approval and automation links" actions={<form className="flex gap-2"><input name="action" defaultValue={sp.action} placeholder="action contains…" className="input h-9 w-48" /><select name="client" defaultValue={sp.client ?? ""} className="input h-9 w-auto"><option value="">All clients</option>{clients.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</select><button className="btn-secondary h-9">Filter</button></form>} />
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px]">
            <thead className="bg-ink-50/60"><tr>{["When", "Actor", "Action", "Client", "Entity", "Old → New", "Source", "Approval / run", "IP"].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
            <tbody>
              {logs.map((l) => (
                <tr key={l.id} className="tr align-top text-xs">
                  <td className="td whitespace-nowrap">{fmtDate(l.createdAt, true)}</td>
                  <td className="td">{l.userId ? u.get(l.userId) ?? "user" : ""} <span className="text-ink-400">({l.actorType.toLowerCase()})</span></td>
                  <td className="td font-medium">{l.action}</td>
                  <td className="td">{l.clientId ? c.get(l.clientId) : "—"}</td>
                  <td className="td">{l.entityType ?? "—"}</td>
                  <td className="td max-w-[380px]">
                    {(l.oldValue != null || l.newValue != null) && <details><summary className="cursor-pointer text-ink-500">view</summary><pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded bg-ink-50 p-2 text-[10px]">{JSON.stringify({ old: l.oldValue, new: l.newValue }, null, 1).slice(0, 3000)}</pre></details>}
                  </td>
                  <td className="td">{l.source}</td>
                  <td className="td text-[10px] text-ink-400">{l.approvalId ?? ""}{l.automationRunId ?? ""}</td>
                  <td className="td">{l.ip ?? ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex justify-between border-t border-ink-100 px-5 py-3 text-xs">
          {page > 0 ? <a className="link" href={`?page=${page - 1}`}>← Newer</a> : <span />}
          {logs.length === 100 && <a className="link" href={`?page=${page + 1}`}>Older →</a>}
        </div>
      </Card>
    </>
  );
}
