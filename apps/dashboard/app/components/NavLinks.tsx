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

const groups = [
  {
    label: "Arbetsyta",
    items: [
      { href: "/",          label: "Översikt",     icon: LayoutDashboard },
      { href: "/approvals", label: "Godkännanden", icon: Inbox },
      { href: "/agents",    label: "Agenter",      icon: Bot },
      { href: "/leads",     label: "Leads",        icon: Users },
      { href: "/runs",      label: "Körningar",    icon: Workflow },
    ],
  },
  {
    label: "Insikter",
    items: [
      { href: "/analytics", label: "Analys",      icon: BarChart3 },
      { href: "/billing",   label: "Fakturering", icon: CreditCard },
    ],
  },
  {
    label: "Konto",
    items: [
      { href: "/settings", label: "Inställningar", icon: Settings },
    ],
  },
];

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-2 space-y-4 overflow-y-auto no-scrollbar">
      {groups.map((group) => (
        <div key={group.label}>
          <div className="px-3 mb-1 text-[9px] font-bold text-white/20 uppercase tracking-[0.15em]">
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
                  className={`group flex items-center gap-2.5 px-3 py-2 rounded-lg text-[13px] font-medium transition-all duration-150 ${
                    active
                      ? "bg-white/10 text-white"
                      : "text-white/40 hover:text-white/80 hover:bg-white/5"
                  }`}
                >
                  {/* Active indicator */}
                  <span className={`absolute left-3 w-0.5 h-4 rounded-full bg-brand transition-opacity duration-150 ${active ? "opacity-100" : "opacity-0"}`} style={{position: "relative", flexShrink: 0, width: 2, height: 16, borderRadius: 2, background: active ? "#e8a020" : "transparent"}} />
                  <n.icon
                    size={14}
                    strokeWidth={active ? 2.25 : 1.75}
                    className={`shrink-0 transition-colors ${active ? "text-brand" : "text-white/30 group-hover:text-white/60"}`}
                  />
                  <span className={active ? "text-white" : ""}>{n.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
