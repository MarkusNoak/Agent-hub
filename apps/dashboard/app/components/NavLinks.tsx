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
      { href: "/",          label: "Översikt",      icon: LayoutDashboard },
      { href: "/approvals", label: "Godkännanden",  icon: Inbox },
      { href: "/agents",    label: "Agenter",       icon: Bot },
      { href: "/leads",     label: "Leads",         icon: Users },
      { href: "/runs",      label: "Körningar",     icon: Workflow },
    ],
  },
  {
    label: "Insikter",
    items: [
      { href: "/analytics", label: "Analys",       icon: BarChart3 },
      { href: "/billing",   label: "Fakturering",  icon: CreditCard },
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
    <nav className="flex-1 px-3 py-1.5 space-y-5 overflow-y-auto no-scrollbar">
      {groups.map((group) => (
        <div key={group.label}>
          {/* Group label */}
          <div
            className="px-3 mb-1"
            style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", color: "rgb(255 255 255 / 0.2)" }}
          >
            {group.label}
          </div>

          <div className="space-y-px">
            {group.items.map((n) => {
              const active =
                n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);

              return (
                <Link
                  key={n.href}
                  href={n.href}
                  className="group flex items-center gap-2.5 px-3 py-[7px] rounded-[10px] text-[13px] font-medium transition-all duration-100 relative"
                  style={{
                    background: active ? "rgb(255 255 255 / 0.09)" : "transparent",
                    color: active ? "rgb(255 255 255 / 0.95)" : "rgb(255 255 255 / 0.38)",
                  }}
                  onMouseEnter={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = "rgb(255 255 255 / 0.05)";
                      (e.currentTarget as HTMLElement).style.color = "rgb(255 255 255 / 0.72)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!active) {
                      (e.currentTarget as HTMLElement).style.background = "transparent";
                      (e.currentTarget as HTMLElement).style.color = "rgb(255 255 255 / 0.38)";
                    }
                  }}
                >
                  {/* Amber active bar */}
                  {active && (
                    <span
                      className="absolute left-0 top-1/2 -translate-y-1/2 rounded-full"
                      style={{
                        width: 3,
                        height: 18,
                        background: "linear-gradient(180deg, #f0b030, #e8960c)",
                        boxShadow: "0 0 8px rgb(232 160 32 / 0.6)",
                        borderRadius: 2,
                      }}
                    />
                  )}

                  <n.icon
                    size={14}
                    strokeWidth={active ? 2.3 : 1.7}
                    style={{
                      color: active ? "#f0b030" : "inherit",
                      flexShrink: 0,
                      transition: "color 0.1s",
                    }}
                  />
                  <span>{n.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}
