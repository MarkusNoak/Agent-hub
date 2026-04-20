import "./globals.css";
import type { Metadata } from "next";
import Link from "next/link";
import { Inbox, Bot, Users, Settings, LayoutDashboard, Workflow } from "lucide-react";
import { getActiveTenant } from "@/lib/tenant";

export const metadata: Metadata = {
  title: "Agent Hub",
  description: "Multi-tenant AI agent platform",
};

const nav = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/approvals", label: "Approvals", icon: Inbox },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/runs", label: "Runs", icon: Workflow },
  { href: "/settings", label: "Settings", icon: Settings },
];

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();

  return (
    <html lang="en">
      <body>
        {tenant ? (
          <div className="grid grid-cols-[260px_1fr] min-h-screen">
            <aside className="bg-white border-r border-ink-100 p-4 flex flex-col">
              <div className="mb-6">
                <div className="text-xs text-ink-500 uppercase tracking-wider">Tenant</div>
                <div className="font-semibold">{tenant.name}</div>
                <div className="text-xs text-ink-500">{tenant.slug} · {tenant.plan}</div>
              </div>
              <nav className="flex flex-col gap-1">
                {nav.map((n) => (
                  <Link
                    key={n.href}
                    href={n.href}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-ink-700 hover:bg-ink-50"
                  >
                    <n.icon size={16} />
                    {n.label}
                  </Link>
                ))}
              </nav>
              <div className="mt-auto pt-4 border-t border-ink-100 text-xs text-ink-500">
                {tenant.user.email}
              </div>
            </aside>
            <main className="p-8 max-w-6xl">{children}</main>
          </div>
        ) : (
          <>{children}</>
        )}
      </body>
    </html>
  );
}
