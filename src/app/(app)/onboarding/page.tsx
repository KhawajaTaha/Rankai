import Link from "next/link";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientWhere } from "@/lib/tenancy";
import { STAGES } from "@/lib/services/onboarding";
import { Avatar, Badge, PageHeader, Progress, timeAgo } from "@/components/ui";

export const metadata = { title: "Onboarding" };

export default async function OnboardingPage() {
  const ctx = await requireStaff();
  const clients = await db.client.findMany({ where: clientWhere(ctx), include: { checklist: { select: { complete: true } }, tasks: { where: { source: "ONBOARDING", status: { notIn: ["COMPLETED", "CANCELLED"] } }, select: { title: true, dueAt: true } } }, orderBy: { createdAt: "desc" } });
  return (
    <>
      <PageHeader title="Onboarding pipeline" subtitle="Clients move through stages automatically as information and connections arrive. Missing tasks are created for you." actions={ctx.can("create_client") && <Link href="/clients/new" className="btn-primary">+ Add Client</Link>} />
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((s) => {
          const list = clients.filter((c) => c.onboardingStage === s.stage);
          return (
            <div key={s.stage} className="w-64 shrink-0">
              <div className="mb-2 flex items-center justify-between px-1"><span className="text-xs font-semibold text-ink-700">{s.label}</span><Badge>{list.length}</Badge></div>
              <div className="min-h-[300px] space-y-2 rounded-2xl bg-ink-100/60 p-2">
                {list.map((c) => {
                  const done = c.checklist.filter((x) => x.complete).length;
                  const overdue = c.tasks.some((t) => t.dueAt && t.dueAt < new Date());
                  return (
                    <Link key={c.id} href={`/clients/${c.id}`} className="block rounded-xl border border-ink-200 bg-white p-3 shadow-card hover:border-brand-300">
                      <div className="flex items-center gap-2"><Avatar name={c.name} src={c.logoUrl} size={26} square /><span className="truncate text-sm font-medium">{c.name}</span></div>
                      <Progress value={(done / Math.max(1, c.checklist.length)) * 100} className="mt-2" tone={done === c.checklist.length ? "green" : "brand"} />
                      <div className="mt-1 text-[11px] text-ink-500">{done}/{c.checklist.length} checklist · added {timeAgo(c.createdAt)}</div>
                      {c.tasks[0] && <div className={`mt-1.5 truncate text-[11px] ${overdue ? "text-red-600" : "text-amber-700"}`}>Next: {c.tasks[0].title}</div>}
                    </Link>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}
