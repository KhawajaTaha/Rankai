"use client";

import { usePathname } from "next/navigation";
import { Tabs } from "@/components/ui";

export function ClientTabs({ id, counts }: { id: string; counts: { approvals: number; tasks: number; reviews: number; support: number } }) {
  const path = usePathname();
  const base = `/clients/${id}`;
  const tabs = [
    { href: base, label: "Overview" },
    { href: `${base}/gbp`, label: "GBP" },
    { href: `${base}/website`, label: "Website SEO" },
    { href: `${base}/rankings`, label: "Rankings" },
    { href: `${base}/content`, label: "Content" },
    { href: `${base}/reviews`, label: "Reviews", count: counts.reviews },
    { href: `${base}/reports`, label: "Reports" },
    { href: `${base}/support`, label: "Support", count: counts.support },
    { href: `${base}/tasks`, label: "Tasks", count: counts.tasks },
    { href: `${base}/files`, label: "Files" },
    { href: `${base}/activity`, label: "Activity" },
    { href: `${base}/automations`, label: "Automations", count: counts.approvals },
    { href: `${base}/settings`, label: "Settings" },
  ];
  const active = tabs.slice().reverse().find((t) => path === t.href || path.startsWith(t.href + "/"))?.href ?? base;
  return <Tabs tabs={tabs} active={active} />;
}
