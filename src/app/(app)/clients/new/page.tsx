import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { OnboardingWizard } from "./wizard";

export const metadata = { title: "Add New Client" };

export default async function NewClientPage() {
  const ctx = await requireStaff();
  if (!ctx.can("create_client")) redirect("/clients");
  const [packages, templates, members] = await Promise.all([
    db.servicePackage.findMany({ where: { organizationId: ctx.orgId }, orderBy: { monthlyPrice: "asc" } }),
    db.clientTemplate.findMany({ where: { organizationId: ctx.orgId } }),
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, status: "ACTIVE" }, include: { user: true, role: true } }),
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Add New Client" subtitle="A few simple questions — no SEO knowledge needed. The platform handles the rest." />
      <OnboardingWizard
        canAssign={ctx.can("assign_clients")}
        packages={packages.map((p) => ({ id: p.id, name: p.name, description: `${p.gbpPostsPerWeek} posts/wk, ${p.blogsPerMonth} blogs/mo` }))}
        templates={templates.map((t) => ({ id: t.id, name: t.name, description: t.description }))}
        supportAgents={members.filter((m) => ["support_agent", "support_manager"].includes(m.role.key)).map((m) => ({ id: m.id, name: m.user.name }))}
        seoSpecialists={members.filter((m) => ["seo_specialist", "seo_manager"].includes(m.role.key)).map((m) => ({ id: m.id, name: m.user.name }))}
      />
    </div>
  );
}
