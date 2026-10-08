import Link from "next/link";
import { Bell, LogOut, Search, ShieldCheck } from "lucide-react";
import { Avatar } from "./ui";
import { MobileNav, type NavItem } from "./sidebar";
import { logoutAction } from "@/app/actions/auth";

export function Topbar({ name, role, unread, items, searchAction = "/search", showSearch = true, settingsHref }: { name: string; role: string; unread: number; items: NavItem[]; searchAction?: string; showSearch?: boolean; settingsHref: string }) {
  return (
    <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-ink-200/80 bg-white/85 px-4 backdrop-blur lg:px-8">
      <MobileNav items={items} />
      {showSearch ? (
        <form action={searchAction} className="relative max-w-md flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
          <input name="q" placeholder="Search clients, calls, notes, tasks, keywords, reviews…" className="input h-9 rounded-xl bg-ink-50/70 pl-9" />
        </form>
      ) : (
        <div className="flex-1" />
      )}
      <div className="ml-auto flex items-center gap-1">
        <Link href={items.find((i) => i.href.includes("notifications"))?.href ?? (showSearch ? "/notifications" : "/portal/support")} className="btn-ghost relative h-9 w-9 p-0" aria-label="Notifications">
          <Bell className="h-[18px] w-[18px]" />
          {unread > 0 && <span className="absolute right-1 top-1 min-w-[16px] rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
        </Link>
        <details className="relative">
          <summary className="flex cursor-pointer list-none items-center gap-2 rounded-xl px-2 py-1 hover:bg-ink-50">
            <Avatar name={name} size={30} />
            <span className="hidden text-left sm:block">
              <span className="block text-xs font-semibold text-ink-900">{name}</span>
              <span className="block text-[11px] text-ink-500">{role}</span>
            </span>
          </summary>
          <div className="absolute right-0 z-40 mt-2 w-56 rounded-2xl border border-ink-200 bg-white p-1.5 shadow-pop">
            <Link href={settingsHref} className="flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"><ShieldCheck className="h-4 w-4" /> Security & notifications</Link>
            <form action={logoutAction}>
              <button className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-ink-700 hover:bg-ink-50"><LogOut className="h-4 w-4" /> Sign out</button>
            </form>
          </div>
        </details>
      </div>
    </header>
  );
}
