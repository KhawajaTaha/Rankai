/**
 * Granular permission catalog. Roles are just named bundles of these keys; every check in the
 * application is made against a permission key (never against a role name), and individual
 * members can be granted or revoked specific keys on top of their role.
 */
export const PERMISSIONS = {
  // Clients
  view_all_clients: { group: "Clients", description: "See every client in the agency (otherwise only assigned clients)" },
  create_client: { group: "Clients", description: "Create new clients via the onboarding wizard" },
  edit_client: { group: "Clients", description: "Edit client profile, brand kit and knowledge" },
  delete_client: { group: "Clients", description: "Offboard / archive clients" },
  assign_clients: { group: "Clients", description: "Assign support agents and SEO specialists to clients" },
  bulk_operations: { group: "Clients", description: "Run bulk operations across many clients" },
  // Google Business Profile
  connect_gbp: { group: "Google Business", description: "Connect Google accounts and assign GBP locations" },
  manage_gbp: { group: "Google Business", description: "Edit GBP fields, run GBP audits and sync" },
  // Content
  create_content: { group: "Content", description: "Generate and edit posts, blogs and images" },
  publish_content: { group: "Content", description: "Schedule and publish content" },
  approve_content: { group: "Content", description: "Approve or reject AI output and recommendations" },
  manage_media: { group: "Content", description: "Upload, approve and archive media" },
  manage_reviews: { group: "Content", description: "Draft and post review replies" },
  // Website & SEO
  manage_website: { group: "Website SEO", description: "Connect websites and apply website changes" },
  run_audit: { group: "Website SEO", description: "Run GBP and website audits" },
  rollback_changes: { group: "Website SEO", description: "Roll back website and GBP changes" },
  manage_keywords: { group: "Website SEO", description: "Add keywords, competitors and run rank checks" },
  // Reporting
  view_reports: { group: "Reports", description: "View reports and dashboards" },
  generate_reports: { group: "Reports", description: "Generate and send reports" },
  // Support
  manage_support: { group: "Support", description: "Manage support agents, SLAs and all tickets" },
  view_support_performance: { group: "Support", description: "View support workflow metrics" },
  add_calls: { group: "Support", description: "Log calls" },
  add_notes: { group: "Support", description: "Add support notes" },
  create_tasks: { group: "Support", description: "Create and assign tasks" },
  manage_tickets: { group: "Support", description: "Work client requests / tickets" },
  // Automation
  manage_automations: { group: "Automation", description: "Change automation levels, consent and schedules" },
  pause_automation: { group: "Automation", description: "Pause / resume automation for a client" },
  view_command_center: { group: "Automation", description: "Access the automation command center and run history" },
  // Administration
  manage_integrations: { group: "Administration", description: "Manage integrations and credentials" },
  manage_team: { group: "Administration", description: "Invite staff and edit roles/permissions" },
  manage_settings: { group: "Administration", description: "Agency settings, packages, templates and SLAs" },
  view_audit_log: { group: "Administration", description: "View the immutable audit log" },
  use_agency_assistant: { group: "Administration", description: "Use the agency-wide AI assistant" },
  // Client portal
  portal_access: { group: "Client Portal", description: "Sign in to the client portal" },
  portal_approve: { group: "Client Portal", description: "Approve or reject items in the client portal" },
  portal_request_help: { group: "Client Portal", description: "Submit help requests" },
  portal_connect_gbp: { group: "Client Portal", description: "Connect their own Google Business Profile" },
} as const;

export type PermissionKey = keyof typeof PERMISSIONS;
export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionKey[];

const STAFF_ALL = ALL_PERMISSIONS.filter((p) => !p.startsWith("portal_"));

export type RoleKey =
  | "super_admin"
  | "agency_admin"
  | "seo_manager"
  | "seo_specialist"
  | "content_manager"
  | "support_manager"
  | "support_agent"
  | "client_owner"
  | "client_staff"
  | "read_only";

export const SYSTEM_ROLES: Record<RoleKey, { name: string; description: string; permissions: PermissionKey[]; isClientRole?: boolean }> = {
  super_admin: { name: "Super Admin", description: "Complete system control", permissions: STAFF_ALL },
  agency_admin: {
    name: "Agency Admin",
    description: "Manage the agency, clients, staff, SEO, integrations and automations",
    permissions: STAFF_ALL,
  },
  seo_manager: {
    name: "SEO Manager",
    description: "Manage SEO campaigns and assigned clients",
    permissions: [
      "view_all_clients", "edit_client", "assign_clients", "bulk_operations", "connect_gbp", "manage_gbp",
      "create_content", "publish_content", "approve_content", "manage_media", "manage_reviews",
      "manage_website", "run_audit", "rollback_changes", "manage_keywords", "view_reports", "generate_reports",
      "add_notes", "create_tasks", "manage_automations", "pause_automation", "view_command_center",
    ],
  },
  seo_specialist: {
    name: "SEO Specialist",
    description: "Work only with assigned SEO clients",
    permissions: [
      "manage_gbp", "create_content", "manage_media", "manage_reviews", "manage_website", "run_audit",
      "manage_keywords", "view_reports", "generate_reports", "add_notes", "create_tasks",
    ],
  },
  content_manager: {
    name: "Content Manager",
    description: "Manage posts, blogs and AI-generated media",
    permissions: [
      "view_all_clients", "create_content", "publish_content", "approve_content", "manage_media",
      "manage_reviews", "view_reports", "add_notes", "create_tasks",
    ],
  },
  support_manager: {
    name: "Support Manager",
    description: "Manage support agents, calls, notes, follow-ups and assigned clients",
    permissions: [
      "view_all_clients", "create_client", "edit_client", "assign_clients", "bulk_operations", "manage_support",
      "view_support_performance", "add_calls", "add_notes", "create_tasks", "manage_tickets", "view_reports",
      "pause_automation", "connect_gbp",
    ],
  },
  support_agent: {
    name: "Support Agent",
    description: "Dedicated simplified dashboard for assigned clients",
    permissions: ["create_client", "add_calls", "add_notes", "create_tasks", "manage_tickets", "view_reports"],
  },
  client_owner: {
    name: "Client Owner",
    description: "Sees only their own business",
    isClientRole: true,
    permissions: ["portal_access", "portal_approve", "portal_request_help", "portal_connect_gbp", "view_reports"],
  },
  client_staff: {
    name: "Client Staff",
    description: "Restricted client access",
    isClientRole: true,
    permissions: ["portal_access", "portal_request_help", "view_reports"],
  },
  read_only: {
    name: "Read Only",
    description: "Reporting access only",
    permissions: ["view_all_clients", "view_reports"],
  },
};

export function effectivePermissions(
  rolePermissions: string[],
  granted: string[] = [],
  revoked: string[] = [],
): Set<PermissionKey> {
  const set = new Set<string>([...rolePermissions, ...granted]);
  for (const r of revoked) set.delete(r);
  return new Set([...set].filter((p): p is PermissionKey => p in PERMISSIONS));
}
