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

export function NavLinks() {
  const pathname = usePathname();

  return (
    <nav className="flex-1 px-3 py-4 space-y-0.5">
      {nav.map((n) => {
        const active =
          n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
        return (
          <Link
            key={n.href}
            href={n.href}
            className={`flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-colors ${
              active
                ? "bg-brand-soft text-amber-900 font-semibold"
                : "text-ink-700 hover:bg-ink-50 hover:text-ink-900"
            }`}
          >
            <n.icon
              size={16}
              className={`shrink-0 ${active ? "text-brand" : "text-ink-400"}`}
            />
            {n.label}
          </Link>
        );
      })}
    </nav>
  );
}
