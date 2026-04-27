import "./globals.css";
import type { Metadata } from "next";
import { getActiveTenant } from "@/lib/tenant";
import { NavLinks } from "./components/NavLinks";

export const metadata: Metadata = {
  title: "Agent Hub — We Know IT",
  description: "AI-agenter för försäljning och automation",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();

  return (
    <html lang="sv">
      <body>
        {tenant ? (
          <div className="flex min-h-screen">
            {/* ── Sidebar ── */}
            <aside className="w-[240px] shrink-0 flex flex-col sticky top-0 h-screen bg-white border-r border-ink-100 shadow-[1px_0_0_0_#ede7dc]">

              {/* Logo area — dark gradient */}
              <div
                className="px-5 py-5 border-b border-ink-800/40"
                style={{ background: "linear-gradient(135deg, #1a1410 0%, #2e271d 100%)" }}
              >
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-lg bg-brand flex items-center justify-center shadow-md shrink-0">
                    <svg width="16" height="16" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                      <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#1a1410" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M14 18v3M14 6v-2" stroke="#1a1410" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="font-bold text-base tracking-tight text-white leading-none">weknowit</div>
                    <div className="text-[10px] text-brand/80 font-medium mt-0.5 leading-none">Agent Hub</div>
                  </div>
                </div>

                {/* Tenant badge */}
                <div className="mt-4 px-3 py-2.5 rounded-xl bg-white/5 border border-white/8">
                  <div className="text-[10px] font-medium text-white/40 uppercase tracking-widest mb-0.5">Workspace</div>
                  <div className="text-sm font-semibold text-white leading-snug">{tenant.name}</div>
                  <div className="text-[11px] text-brand/70 capitalize mt-0.5">{tenant.plan}</div>
                </div>
              </div>

              {/* Nav links */}
              <NavLinks />

              {/* Footer */}
              <div className="px-4 py-3 border-t border-ink-100 flex items-center gap-2.5">
                <div className="w-7 h-7 rounded-full bg-gradient-brand flex items-center justify-center text-white text-xs font-bold shrink-0">
                  {tenant.user.email?.charAt(0).toUpperCase() ?? "?"}
                </div>
                <div className="min-w-0">
                  <div className="text-xs font-medium text-ink-700 truncate">{tenant.user.email}</div>
                </div>
              </div>
            </aside>

            {/* ── Main content ── */}
            <main className="flex-1 overflow-y-auto bg-ink-50 min-h-screen">
              <div className="max-w-5xl mx-auto px-8 py-8">
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
