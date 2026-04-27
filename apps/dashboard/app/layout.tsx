import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getActiveTenant } from "@/lib/tenant";
import { NavLinks } from "./components/NavLinks";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Agent Hub — We Know IT",
  description: "AI-agenter för försäljning och automation",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();

  return (
    <html lang="sv" className={inter.variable}>
      <body className="font-sans">
        {tenant ? (
          <div className="flex min-h-screen">

            {/* ── Sidebar ── */}
            <aside className="w-[220px] shrink-0 flex flex-col sticky top-0 h-screen bg-[#111009] overflow-hidden">

              {/* Logo */}
              <div className="px-5 pt-6 pb-5">
                <div className="flex items-center gap-2.5 mb-6">
                  <div className="w-7 h-7 rounded-lg bg-brand flex items-center justify-center shrink-0">
                    <svg width="14" height="14" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                      <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M14 18v3M14 6v-2" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-white font-bold text-sm tracking-tight leading-none">weknowit</div>
                    <div className="text-brand/60 text-[10px] font-medium mt-0.5 tracking-wide">Agent Hub</div>
                  </div>
                </div>

                {/* Tenant */}
                <div>
                  <div className="text-[10px] font-semibold text-white/25 uppercase tracking-[0.12em] mb-1">Workspace</div>
                  <div className="text-sm font-semibold text-white/90 leading-snug">{tenant.name}</div>
                  <div className="text-[11px] text-brand/50 capitalize mt-0.5">{tenant.plan}</div>
                </div>
              </div>

              {/* Separator */}
              <div className="mx-5 h-px bg-white/6 mb-2" />

              {/* Nav */}
              <NavLinks />

              {/* Footer */}
              <div className="mx-5 h-px bg-white/6 mb-3" />
              <div className="px-4 pb-5">
                <div className="flex items-center gap-2.5">
                  <div className="w-7 h-7 rounded-full bg-brand/20 border border-brand/30 flex items-center justify-center text-brand text-[11px] font-bold shrink-0">
                    {tenant.user.email?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] text-white/50 truncate">{tenant.user.email}</div>
                  </div>
                </div>
              </div>
            </aside>

            {/* ── Main ── */}
            <main className="flex-1 min-h-screen bg-[#f7f4f0] overflow-y-auto">
              <div className="max-w-[1000px] mx-auto px-8 py-8">
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
