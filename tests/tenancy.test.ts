import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ notFound: () => { throw new Error("NOT_FOUND"); }, redirect: () => { throw new Error("REDIRECT"); } }));

const hasDb = Boolean(process.env.DATABASE_URL);

describe.skipIf(!hasDb)("tenant isolation (database)", async () => {
  const { db } = await import("@/lib/db");
  const { clientWhere, assertClientAccess } = await import("@/lib/tenancy");
  const { effectivePermissions } = await import("@/lib/permissions");
  type Ctx = Parameters<typeof clientWhere>[0];

  async function ctxFor(email: string): Promise<Ctx> {
    const m = await db.organizationUser.findFirstOrThrow({ where: { user: { email } }, include: { role: true, organization: true, user: true } });
    const permissions = effectivePermissions(m.role.permissions, m.grantedPermissions, m.revokedPermissions);
    return { orgId: m.organizationId, memberId: m.id, isClientUser: m.role.isClientRole, portalClientId: m.clientId, can: (p: string) => permissions.has(p as never), permissions } as unknown as Ctx;
  }

  it("support agents only see assigned clients", async () => {
    const maya = await ctxFor("maya@northpeak.example");
    const visible = await db.client.findMany({ where: clientWhere(maya), select: { id: true } });
    const assigned = await db.clientAssignment.findMany({ where: { memberId: maya.memberId }, select: { clientId: true } });
    expect(new Set(visible.map((c) => c.id))).toEqual(new Set(assigned.map((a) => a.clientId)));
    const other = await db.client.findFirst({ where: { organizationId: maya.orgId, assignments: { none: { memberId: maya.memberId } } } });
    if (other) await expect(assertClientAccess(maya, other.id)).rejects.toThrow();
  });

  it("client portal users only see their own business", async () => {
    const owner = await ctxFor("owner@superiorcustomgranite.example");
    const visible = await db.client.findMany({ where: clientWhere(owner) });
    expect(visible).toHaveLength(1);
    expect(visible[0]!.id).toBe(owner.portalClientId);
  });

  it("no client is visible across organisations", async () => {
    const admin = await ctxFor("admin@northpeak.example");
    const foreign = { ...admin, orgId: "some-other-org" } as Ctx;
    expect(await db.client.count({ where: clientWhere(foreign) })).toBe(0);
  });
});
