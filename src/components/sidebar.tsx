"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle, BarChart3, Bell, Bot, CalendarClock, CheckCircle2, FileText, Globe, Headphones, Inbox, LayoutDashboard, ListTodo, MapPin, Menu,
  MessageSquare, Phone, Plug, Settings, Sparkles, Star, StickyNote, TrendingUp, UserPlus, Users, UsersRound, Workflow,
} from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = {
  AlertTriangle, BarChart3, Bell, Bot, CalendarClock, CheckCircle2, FileText, Globe, Headphones, Inbox, LayoutDashboard, ListTodo, MapPin,
  MessageSquare, Phone, Plug, Settings, Sparkles, Star, StickyNote, TrendingUp, UserPlus, Users, UsersRound, Workflow,
};

export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; badge?: number; section?: string };

export function Sidebar({ items, brand, sub }: { items: NavItem[]; brand: string; sub: string }) {
  const path = usePathname();
  let lastSection: string | undefined;
  return (
    <aside className="sticky top-0 hidden h-screen w-[244px] shrink-0 flex-col border-r border-ink-200/80 bg-white lg:flex">
      <div className="flex items-center gap-2.5 px-5 py-5">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-sm">
          <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M12 2l3 7h7l-5.5 4.5L18.5 21 12 16.5 5.5 21l2-7.5L2 9h7z" /></svg>
        </span>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-ink-900">{brand}</div>
          <div className="truncate text-[11px] text-ink-500">{sub}</div>
        </div>
      </div>
      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 pb-6">
        {items.map((it) => {
          const Icon = ICONS[it.icon];
          const active = path === it.href || (it.href !== "/" && path.startsWith(it.href + "/")) || (it.href === "/portal" && path === "/portal");
          const header = it.section && it.section !== lastSection ? it.section : null;
          lastSection = it.section;
          return (
            <div key={it.href}>
              {header && <div className="px-3 pb-1 pt-4 text-[10px] font-semibold uppercase tracking-wider text-ink-400">{header}</div>}
              <Link href={it.href} className={cn("group flex items-center gap-2.5 rounded-xl px-3 py-2 text-[13px] font-medium transition", active ? "bg-brand-50 text-brand-700" : "text-ink-600 hover:bg-ink-50 hover:text-ink-900")}>
                <Icon className={cn("h-4 w-4", active ? "text-brand-600" : "text-ink-400 group-hover:text-ink-600")} />
                <span className="flex-1 truncate">{it.label}</span>
                {it.badge ? <span className={cn("rounded-full px-1.5 py-0.5 text-[10px] font-semibold", active ? "bg-brand-600 text-white" : "bg-red-100 text-red-700")}>{it.badge}</span> : null}
              </Link>
            </div>
          );
        })}
      </nav>
    </aside>
  );
}

export function MobileNav({ items }: { items: NavItem[] }) {
  return (
    <details className="relative lg:hidden">
      <summary className="btn-ghost btn-sm list-none"><Menu className="h-5 w-5" /></summary>
      <div className="absolute left-0 z-40 mt-2 w-64 rounded-2xl border border-ink-200 bg-white p-2 shadow-pop">
        {items.map((it) => (
          <Link key={it.href} href={it.href} className="block rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50">{it.label}</Link>
        ))}
      </div>
    </details>
  );
}
