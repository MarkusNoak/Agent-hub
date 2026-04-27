"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Inbox,
  Bot,
  Users,
  Workflow,
  BarChart3,
  CreditCard,
  Settings,
} from "lucide-react";

const nav = [
  { href: "/",          label: "Översikt",      icon: LayoutDashboard },
  { href: "/approvals", label: "Godkännanden",  icon: Inbox },
  { href: "/agents",    label: "Agenter",       icon: Bot },
  { href: "/leads",     label: "Leads",         icon: Users },
  { href: "/runs",      label: "Körningar",     icon: Workflow },
  { href: "/analytics", label: "Analys",        icon: BarChart3 },
  { href: "/billing",   label: "Fakturering",   icon: CreditCard },
  { href: "/settings",  label: "Inställningar", icon: Settings },
];

const groups = [
  { label: "Arbetsyta", items: nav.slice(0, 5) },
  { label: "Insikter",  items: nav.slice(5, 7) },
  { label: "Konto",     items: nav.slice(7) },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-5 overflow-y-auto">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-3 mb-1.5 text-[10px] font-semibold text-ink-400 uppercase tracking-widest">
            {group.label}
          </div>
          <div className="space-y-0.5">
            {group.items.map((n) => {
              const active =
                n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className={`flex items-center gap-3 px-3 py-2 rounded-xl text-sm font-medium transition-all duration-150 ${
                    active
                      ? "bg-brand-soft text-amber-900 shadow-sm"
                      : "text-ink-600 hover:bg-ink-50 hover:text-ink-900"
                  }`}
                >
                  <n.icon
                    size={15}
                    className={`shrink-0 ${active ? "text-brand" : "text-ink-400"}`}
                    strokeWidth={active ? 2.5 : 1.75}
                  />
                  <span className={active ? "font-semibold" : ""}>{n.label}</span>
                  {n.href === "/approvals" && active === false && (
                    <span className="ml-auto" />
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
