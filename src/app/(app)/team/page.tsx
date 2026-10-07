import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { PERMISSIONS, type PermissionKey } from "@/lib/permissions";
import { Avatar, Badge, Card, PageHeader, StatusBadge, timeAgo } from "@/components/ui";
import { ActionForm, Dialog, Field, SubmitButton } from "@/components/client";
import { inviteStaffAction, saveRoleAction, updateMemberAction } from "@/app/actions/team";

export const metadata = { title: "Team" };

export default async function TeamPage() {
  const ctx = await requireStaff();
  if (!ctx.can("manage_team")) redirect("/dashboard");
  const [members, roles, assignments] = await Promise.all([
    db.organizationUser.findMany({ where: { organizationId: ctx.orgId, role: { isClientRole: false } }, include: { user: true, role: true }, orderBy: { createdAt: "asc" } }),
    db.role.findMany({ where: { organizationId: ctx.orgId }, orderBy: { createdAt: "asc" } }),
    db.clientAssignment.groupBy({ by: ["memberId"], where: { organizationId: ctx.orgId }, _count: true }),
  ]);
  const staffRoles = roles.filter((r) => !r.isClientRole);
  const groups = [...new Set(Object.values(PERMISSIONS).map((p) => p.group))];
  return (
    <>
      <PageHeader title="Team" subtitle="Roles are bundles of granular permissions; each member can also be granted or revoked individual permissions" actions={
        <Dialog trigger="+ Invite team member" title="Invite team member" triggerClassName="btn-primary">
          <ActionForm action={inviteStaffAction} className="grid gap-3">
            <Field label="Name"><input name="name" className="input" /></Field>
            <Field label="Email"><input name="email" type="email" className="input" /></Field>
            <Field label="Title"><input name="title" className="input" /></Field>
            <Field label="Role"><select name="roleId" className="input">{staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
            <SubmitButton>Send invite</SubmitButton>
          </ActionForm>
        </Dialog>
      } />
      <Card title="Members" pad={false}>
        <table className="w-full min-w-[900px]">
          <thead className="bg-ink-50/60"><tr>{["Member", "Role", "Overrides", "Clients", "Last login", "Status", ""].map((h) => <th key={h} className="th">{h}</th>)}</tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="tr text-sm">
                <td className="td"><span className="flex items-center gap-2.5"><Avatar name={m.user.name} size={30} /><span><span className="block font-medium">{m.user.name}</span><span className="block text-xs text-ink-500">{m.user.email}{m.title ? ` · ${m.title}` : ""}</span></span></span></td>
                <td className="td"><Badge tone="blue">{m.role.name}</Badge>{m.user.totpEnabled && <Badge tone="green" className="ml-1">2FA</Badge>}</td>
                <td className="td text-xs">{m.grantedPermissions.map((p) => <Badge key={p} tone="green" className="mr-1">+{p}</Badge>)}{m.revokedPermissions.map((p) => <Badge key={p} tone="red" className="mr-1">−{p}</Badge>)}</td>
                <td className="td">{assignments.find((a) => a.memberId === m.id)?._count ?? 0}</td>
                <td className="td text-xs">{timeAgo(m.user.lastLoginAt)}</td>
                <td className="td"><StatusBadge status={m.status} /></td>
                <td className="td">
                  <Dialog trigger="Edit" title={`Edit ${m.user.name}`} triggerClassName="btn-secondary btn-sm" wide>
                    <ActionForm action={updateMemberAction.bind(null, m.id)} resetOnSuccess={false} className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-3">
                        <Field label="Role"><select name="roleId" defaultValue={m.roleId} className="input">{staffRoles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</select></Field>
                        <Field label="Title"><input name="title" defaultValue={m.title ?? ""} className="input" /></Field>
                        <Field label="Status"><select name="status" defaultValue={m.status} className="input"><option value="ACTIVE">Active</option><option value="DISABLED">Disabled</option></select></Field>
                      </div>
                      <p className="text-xs text-ink-500">Tick <b>grant</b> to add a permission the role lacks, or <b>revoke</b> to remove one it has. Changing the role clears inapplicable overrides.</p>
                      {groups.map((g) => (
                        <div key={g}>
                          <div className="label">{g}</div>
                          <div className="grid gap-1 sm:grid-cols-2">
                            {(Object.entries(PERMISSIONS) as [PermissionKey, { group: string; description: string }][]).filter(([, p]) => p.group === g).map(([k, p]) => {
                              const has = m.role.permissions.includes(k);
                              return (
                                <label key={k} className="flex items-center gap-2 text-xs" title={p.description}>
                                  <input type="checkbox" name={has ? "revoke" : "grant"} value={k} defaultChecked={has ? m.revokedPermissions.includes(k) : m.grantedPermissions.includes(k)} />
                                  <span className={has ? "text-ink-800" : "text-ink-500"}>{has ? "revoke" : "grant"} <code>{k}</code></span>
                                </label>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                      <SubmitButton>Save member</SubmitButton>
                    </ActionForm>
                  </Dialog>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <Card title="Roles & permissions" subtitle="Checks are made against permissions, never role names" className="mt-5" pad={false} actions={
        <Dialog trigger="+ Custom role" title="New custom role" triggerClassName="btn-secondary btn-sm" wide>
          <ActionForm action={saveRoleAction} className="space-y-3">
            <Field label="Role name"><input name="name" className="input" /></Field>
            <div className="grid gap-1 sm:grid-cols-2">{Object.keys(PERMISSIONS).map((k) => <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" name="perm" value={k} /><code>{k}</code></label>)}</div>
            <SubmitButton>Create role</SubmitButton>
          </ActionForm>
        </Dialog>
      }>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-ink-50/60"><tr><th className="th">Permission</th>{roles.map((r) => <th key={r.id} className="th whitespace-nowrap text-center">{r.name}</th>)}</tr></thead>
            <tbody>
              {Object.entries(PERMISSIONS).map(([k, p]) => (
                <tr key={k} className="tr"><td className="td" title={p.description}><code>{k}</code><div className="text-[10px] text-ink-400">{p.group}</div></td>{roles.map((r) => <td key={r.id} className="td text-center">{r.permissions.includes(k) ? <span className="text-emerald-600">●</span> : <span className="text-ink-200">○</span>}</td>)}</tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-ink-100 p-4">
          {roles.filter((r) => r.key !== "super_admin").map((r) => (
            <Dialog key={r.id} trigger={`Edit ${r.name}`} title={`Edit role: ${r.name}`} triggerClassName="btn-ghost btn-sm" wide>
              <ActionForm action={saveRoleAction} resetOnSuccess={false} className="space-y-3">
                <input type="hidden" name="roleId" value={r.id} />
                <div className="grid gap-1 sm:grid-cols-2">{Object.keys(PERMISSIONS).map((k) => <label key={k} className="flex items-center gap-2 text-xs"><input type="checkbox" name="perm" value={k} defaultChecked={r.permissions.includes(k)} /><code>{k}</code></label>)}</div>
                <SubmitButton>Save role</SubmitButton>
              </ActionForm>
            </Dialog>
          ))}
        </div>
      </Card>
    </>
  );
}
