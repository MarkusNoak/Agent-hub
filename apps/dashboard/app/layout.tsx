import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Bot, Users, Settings, LayoutDashboard, Workflow } from "lucide-react";
import { getActiveTenant } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "Agent Hub — We Know IT",
  description: "AI-agenter för försäljning och automation",
};

const nav = [
  { href: "/",          label: "Översikt",        icon: LayoutDashboard },
  { href: "/approvals", label: "Godkännanden",     icon: Inbox },
  { href: "/agents",    label: "Agenter",          icon: Bot },
  { href: "/leads",     label: "Leads",            icon: Users },
  { href: "/runs",      label: "Körningar",        icon: Workflow },
  { href: "/settings",  label: "Inställningar",    icon: Settings },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();

  return (
    <html lang="sv">
      <body>
        {tenant ? (
          <div className="grid grid-cols-[260px_1fr] min-h-screen">
            {/* Sidebar */}
            <aside className="bg-white border-r border-ink-100 flex flex-col">
              {/* Logo */}
              <div className="px-5 py-5 border-b border-ink-100">
                <div className="flex items-center gap-2">
                  {/* Stylised S-bolt matching weknowit.se */}
                  <svg width="28" height="28" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                    <rect width="28" height="28" rx="7" fill="#1a1410"/>
                    <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#e8a020" strokeWidth="2" strokeLinecap="round"/>
                    <path d="M14 18v4M14 6v-2" stroke="#e8a020" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                  <span className="font-bold text-lg tracking-tight text-ink-900">weknowit</span>
                </div>
                <div className="mt-3 px-1">
                  <div className="text-xs font-medium text-ink-500 uppercase tracking-wider mb-0.5">Workspace</div>
                  <div className="text-sm font-semibold text-ink-900">{tenant.name}</div>
                  <div className="text-xs text-ink-500">{tenant.plan}</div>
                </div>
              </div>

              {/* Nav */}
              <nav className="flex-1 px-3 py-4 space-y-0.5">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm text-ink-700 hover:bg-ink-50 hover:text-ink-900 transition-colors font-medium"
                  >
                    <n.icon size={16} className="shrink-0 text-ink-500" />
                    {n.label}
                  </Link>
                ))}
              </nav>

              {/* Footer */}
              <div className="px-5 py-4 border-t border-ink-100">
                <div className="text-xs text-ink-500 truncate">{tenant.user.email}</div>
              </div>
            </aside>

            {/* Main content */}
            <main className="p-8 overflow-y-auto bg-ink-50">
              <div className="max-w-5xl mx-auto">
                {children}
              </div>
            </main>
          </div>
        ) : (
          <>{children}</>
        )}
      </body>
    </html>
  );
}
