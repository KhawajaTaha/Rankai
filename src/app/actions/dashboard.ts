"use server";

import { db } from "@/lib/db";
import { getCtx } from "@/lib/auth";

export async function saveDashboardLayout(order: string[]) {
  const ctx = await getCtx();
  if (!ctx) return;
  const clean = order.filter((x) => typeof x === "string" && x.length < 40).slice(0, 30);
  await db.organizationUser.update({ where: { id: ctx.memberId }, data: { dashboardLayout: { order: clean } } });
}
