/* First-time live setup: creates your agency, roles, SLAs, packages, templates and the admin account.
 * No demo clients or mock data are created.
 *
 *   SETUP_ADMIN_EMAIL=you@toptechdigital.ai SETUP_ADMIN_NAME="Your Name" SETUP_ADMIN_PASSWORD='a-strong-password' npm run setup:live
 */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { PERMISSIONS, SYSTEM_ROLES } from "../src/lib/permissions";

const db = new PrismaClient();

async function main() {
  const email = (process.env.SETUP_ADMIN_EMAIL ?? "").trim().toLowerCase();
  const name = (process.env.SETUP_ADMIN_NAME ?? "").trim();
  const password = process.env.SETUP_ADMIN_PASSWORD ?? "";
  const orgName = (process.env.SETUP_ORG_NAME ?? "Top Tech Digital.AI").trim();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || name.length < 2) throw new Error("Set SETUP_ADMIN_EMAIL and SETUP_ADMIN_NAME");
  if (password.length < 10) throw new Error("SETUP_ADMIN_PASSWORD must be at least 10 characters");
  if (await db.organization.findFirst()) throw new Error("An organization already exists — setup has already been run.");

  for (const [key, p] of Object.entries(PERMISSIONS)) {
    await db.permission.upsert({ where: { key }, create: { key, group: p.group, description: p.description }, update: { group: p.group, description: p.description } });
  }
  const org = await db.organization.create({ data: { name: orgName, slug: orgName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, ""), whiteLabelName: orgName, logoUrl: "/brand/mark.png", brandColor: "#1f4fae", timezone: process.env.SETUP_TIMEZONE ?? "Asia/Karachi" } });
  const roles: Record<string, string> = {};
  for (const [key, r] of Object.entries(SYSTEM_ROLES)) {
    roles[key] = (await db.role.create({ data: { organizationId: org.id, key, name: r.name, description: r.description, permissions: r.permissions, isSystem: true, isClientRole: Boolean(r.isClientRole) } })).id;
  }
  await db.slaPolicy.createMany({
    data: [
      { organizationId: org.id, priority: "URGENT", respondWithinHours: 2, resolveWithinHours: 24 },
      { organizationId: org.id, priority: "HIGH", respondWithinHours: 8, resolveWithinHours: 48 },
      { organizationId: org.id, priority: "NORMAL", respondWithinHours: 24, resolveWithinHours: 120 },
      { organizationId: org.id, priority: "LOW", respondWithinHours: 48 },
    ],
  });
  await db.servicePackage.createMany({
    data: [
      { organizationId: org.id, name: "Local SEO Basic", gbpPostsPerWeek: 1, blogsPerMonth: 0, rankTracking: "WEEKLY", mapGrid: "OFF", reports: "MONTHLY" },
      { organizationId: org.id, name: "Local SEO Pro", gbpPostsPerWeek: 2, blogsPerMonth: 1, rankTracking: "WEEKLY", mapGrid: "MONTHLY", reports: "MONTHLY" },
      { organizationId: org.id, name: "SEO + Website", gbpPostsPerWeek: 2, blogsPerMonth: 2, rankTracking: "WEEKLY", mapGrid: "WEEKLY", websiteAutomation: true, reports: "BOTH" },
      { organizationId: org.id, name: "Full Growth", gbpPostsPerWeek: 3, blogsPerMonth: 4, rankTracking: "WEEKLY", mapGrid: "WEEKLY", websiteAutomation: true, reports: "BOTH" },
    ],
  });
  await db.clientTemplate.createMany({
    data: [
      { organizationId: org.id, name: "Home Services", industry: "Home Services", description: "2 GBP posts/week, 1 blog/month, weekly rank tracking, positive review replies, monthly report", automation: { postsPerWeek: 2, postDays: [1, 4], blogsPerMonth: 1, blogsEnabled: true, rankTracking: "WEEKLY", reviewAutoReply: "AUTO_POSITIVE", autoReply5: true, monthlyReport: true } },
      { organizationId: org.id, name: "Healthcare", industry: "Healthcare", description: "2 GBP posts/week, 2 blogs/month, strict review approval, healthcare-safe content", contentSafety: "healthcare-safe", automation: { postsPerWeek: 2, postDays: [2, 5], blogsPerMonth: 2, blogsEnabled: true, reviewAutoReply: "APPROVAL_ALL", postsRequireApproval: true, blogRequireApproval: true, imageStyle: "Healthcare" } },
      { organizationId: org.id, name: "Auto Services", industry: "Automotive", description: "3 GBP posts/week, local service content, weekly map grid", automation: { postsPerWeek: 3, postDays: [1, 3, 5], mapGrid: "WEEKLY", imageStyle: "Automotive" } },
    ],
  });
  const user = await db.user.create({ data: { email, name, passwordHash: await bcrypt.hash(password, 12), isSuperAdmin: true } });
  await db.organizationUser.create({ data: { organizationId: org.id, userId: user.id, roleId: roles.agency_admin!, title: "Owner" } });
  console.log(`\n✔ ${orgName} is ready. Sign in as ${email}.\n  Next: open Settings → Go-Live to connect AI, Google, email and rank tracking.`);
}

main()
  .catch((e) => {
    console.error(`✖ ${(e as Error).message}`);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
