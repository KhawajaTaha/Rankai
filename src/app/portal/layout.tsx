import { requirePortal } from "@/lib/auth";
import { db } from "@/lib/db";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePortal();
  const [client, approvals, unread] = await Promise.all([
    db.client.findUniqueOrThrow({ where: { id: ctx.portalClientId } }),
    db.approval.count({ where: { clientId: ctx.portalClientId, status: "PENDING", requiresClient: true } }),
    db.notification.count({ where: { recipientId: ctx.memberId, readAt: null } }),
  ]);
  const items: NavItem[] = [
    { href: "/portal", label: "Overview", icon: "LayoutDashboard" },
    { href: "/portal/google-business", label: "Google Business", icon: "MapPin" },
    { href: "/portal/website", label: "Website SEO", icon: "Globe" },
    { href: "/portal/rankings", label: "Rankings", icon: "TrendingUp" },
    { href: "/portal/content", label: "Content", icon: "FileText" },
    { href: "/portal/reviews", label: "Reviews", icon: "Star" },
    { href: "/portal/reports", label: "Reports", icon: "BarChart3" },
    { href: "/portal/support", label: "Support", icon: "Headphones" },
    ...(ctx.can("portal_approve") ? [{ href: "/portal/approvals", label: "Approvals", icon: "CheckCircle2", badge: approvals } as NavItem] : []),
    { href: "/portal/settings", label: "Settings", icon: "Settings" },
  ];
  return (
    <div className="flex min-h-screen">
      <Sidebar items={items} brand={client.name} sub={`Powered by ${ctx.org.whiteLabelName ?? ctx.org.name}`} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={ctx.user.name} role={ctx.roleName} unread={unread} items={items} showSearch={false} settingsHref="/portal/settings" />
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
