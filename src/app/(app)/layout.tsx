import { requireStaff } from "@/lib/auth";
import { db } from "@/lib/db";
import { clientScopeFilter } from "@/lib/tenancy";
import { Sidebar, type NavItem } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireStaff();
  const scope = await clientScopeFilter(ctx);
  const [unread, approvals, alerts, myOpenTasks, openTickets] = await Promise.all([
    db.notification.count({ where: { organizationId: ctx.orgId, recipientId: ctx.memberId, readAt: null } }),
    ctx.can("approve_content") ? db.approval.count({ where: { ...scope, status: "PENDING" } }) : Promise.resolve(0),
    db.alert.count({ where: { ...scope, status: "OPEN", severity: { in: ["CRITICAL", "HIGH"] } } }),
    db.task.count({ where: { organizationId: ctx.orgId, assignedToId: ctx.memberId, status: { notIn: ["COMPLETED", "CANCELLED"] } } }),
    db.supportTicket.count({ where: { ...scope, status: { in: ["OPEN", "IN_PROGRESS"] }, ...(ctx.can("manage_support") ? {} : { assignedToId: ctx.memberId }) } }),
  ]);

  let items: NavItem[];
  if (ctx.experience === "support") {
    items = [
      { href: "/dashboard", label: "My Dashboard", icon: "LayoutDashboard" },
      { href: "/clients", label: "My Clients", icon: "Users" },
      ...(ctx.can("create_client") ? [{ href: "/clients/new", label: "New Client", icon: "UserPlus" } as NavItem] : []),
      { href: "/support/calls", label: "Calls", icon: "Phone" },
      { href: "/support/follow-ups", label: "Follow-Ups", icon: "CalendarClock" },
      { href: "/tasks", label: "Tasks", icon: "ListTodo", badge: myOpenTasks },
      { href: "/support/tickets", label: "Client Requests", icon: "Inbox", badge: openTickets },
      { href: "/support/notes", label: "Notes", icon: "StickyNote" },
      { href: "/notifications", label: "Notifications", icon: "Bell", badge: unread },
    ];
  } else {
    const all: (NavItem & { perm?: Parameters<typeof ctx.can>[0] })[] = [
      { href: "/dashboard", label: "Dashboard", icon: "LayoutDashboard" },
      { href: "/clients", label: "Clients", icon: "Users" },
      { href: "/onboarding", label: "Onboarding", icon: "Workflow" },
      { href: "/google-business", label: "Google Business", icon: "MapPin", section: "Local SEO" },
      { href: "/website-seo", label: "Website SEO", icon: "Globe", section: "Local SEO" },
      { href: "/rankings", label: "Rankings", icon: "TrendingUp", section: "Local SEO" },
      { href: "/content", label: "Content", icon: "FileText", section: "Local SEO" },
      { href: "/reviews", label: "Reviews", icon: "Star", section: "Local SEO" },
      { href: "/approvals", label: "Approvals", icon: "CheckCircle2", badge: approvals, section: "Work", perm: "approve_content" },
      { href: "/tasks", label: "Tasks", icon: "ListTodo", badge: myOpenTasks, section: "Work" },
      { href: "/support", label: "Support", icon: "Headphones", badge: openTickets, section: "Work" },
      { href: "/reports", label: "Reports", icon: "BarChart3", section: "Work", perm: "view_reports" },
      { href: "/automations", label: "Automations", icon: "Bot", section: "Operations", perm: "view_command_center" },
      { href: "/alerts", label: "Alerts", icon: "AlertTriangle", badge: alerts, section: "Operations" },
      { href: "/assistant", label: "AI Assistant", icon: "Sparkles", section: "Operations", perm: "use_agency_assistant" },
      { href: "/team", label: "Team", icon: "UsersRound", section: "Admin", perm: "manage_team" },
      { href: "/integrations", label: "Integrations", icon: "Plug", section: "Admin", perm: "manage_integrations" },
      { href: "/settings", label: "Settings", icon: "Settings", section: "Admin" },
    ];
    items = all.filter((i) => !i.perm || ctx.can(i.perm));
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar items={items} logo={ctx.org.logoUrl} brand={ctx.org.whiteLabelName ?? ctx.org.name} sub={ctx.experience === "support" ? "Support workspace" : "Agency workspace"} />
      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar name={ctx.user.name} role={ctx.roleName} unread={unread} items={items} settingsHref="/settings/security" />
        <main className="mx-auto w-full max-w-[1400px] flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
