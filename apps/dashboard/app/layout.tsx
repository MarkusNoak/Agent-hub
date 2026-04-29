import "./globals.css";
import type { Metadata } from "next";
import { Inter } from "next/font/google";
import { getActiveTenant } from "@/lib/tenant";
import { NavLinks } from "./components/NavLinks";
import { MobileSidebar } from "./components/MobileSidebar";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["300", "400", "500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "Agent Hub — weknowit",
  description: "AI-agenter för försäljning och automation",
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const tenant = await getActiveTenant();

  return (
    <html lang="sv" className={inter.variable}>
      <body className="font-sans antialiased">
        {tenant ? (
          <div className="flex min-h-screen">

            {/* ── Mobile sidebar (hamburger + drawer) ── */}
            <MobileSidebar
              tenantName={tenant.name}
              tenantPlan={tenant.plan}
              tenantInitial={tenant.name.charAt(0).toUpperCase()}
              userEmail={tenant.user.email ?? ""}
              role={tenant.role}
            />

            {/* ── Desktop sidebar ── */}
            <aside
              className="hidden md:flex w-[228px] shrink-0 flex-col sticky top-0 h-screen overflow-hidden"
              style={{
                background: "linear-gradient(180deg, #151210 0%, #111009 40%, #0e0d08 100%)",
                borderRight: "1px solid rgb(255 255 255 / 0.05)",
              }}
            >
              {/* Logo area */}
              <div className="px-5 pt-6 pb-5">
                <div className="flex items-center gap-2.5">
                  {/* Icon mark */}
                  <div
                    className="w-8 h-8 rounded-xl flex items-center justify-center shrink-0"
                    style={{
                      background: "linear-gradient(145deg, #f0b030 0%, #e8960c 100%)",
                      boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25), 0 2px 8px rgb(232 160 32 / 0.35)",
                    }}
                  >
                    <svg width="15" height="15" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                      <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                      <path d="M14 18v3M14 6v-2" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                    </svg>
                  </div>
                  <div>
                    <div className="text-white font-bold text-[13px] tracking-[-0.01em] leading-none">weknowit</div>
                    <div className="text-[10px] font-medium mt-[3px] tracking-[0.06em]" style={{ color: "rgb(232 160 32 / 0.55)" }}>Agent Hub</div>
                  </div>
                </div>
              </div>

              {/* Separator */}
              <div className="mx-5 h-px" style={{ background: "rgb(255 255 255 / 0.06)" }} />

              {/* Workspace badge */}
              <div className="px-5 py-3.5">
                <div className="text-[9px] font-bold uppercase tracking-[0.14em] mb-1.5" style={{ color: "rgb(255 255 255 / 0.22)" }}>
                  Workspace
                </div>
                <div
                  className="flex items-center gap-2.5 rounded-xl px-3 py-2"
                  style={{ background: "rgb(255 255 255 / 0.04)", border: "1px solid rgb(255 255 255 / 0.06)" }}
                >
                  <div
                    className="w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-bold shrink-0"
                    style={{
                      background: "linear-gradient(145deg, #3a3020, #2a2216)",
                      color: "rgb(232 160 32 / 0.9)",
                      border: "1px solid rgb(232 160 32 / 0.2)",
                    }}
                  >
                    {tenant.name.charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[12px] font-semibold truncate" style={{ color: "rgb(255 255 255 / 0.88)" }}>{tenant.name}</div>
                    <div className="text-[10px] capitalize" style={{ color: "rgb(232 160 32 / 0.5)" }}>{tenant.plan}</div>
                  </div>
                </div>
              </div>

              {/* Separator */}
              <div className="mx-5 h-px mb-1" style={{ background: "rgb(255 255 255 / 0.06)" }} />

              {/* Nav */}
              <NavLinks role={tenant.role} />

              {/* Footer */}
              <div className="mx-5 h-px mt-auto mb-3" style={{ background: "rgb(255 255 255 / 0.06)" }} />
              <div className="px-4 pb-5">
                <div className="flex items-center gap-2.5 px-2 py-2 rounded-xl" style={{ background: "rgb(255 255 255 / 0.03)" }}>
                  <div
                    className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0"
                    style={{
                      background: "linear-gradient(145deg, #3a3020, #2a2216)",
                      color: "#f0b030",
                      border: "1px solid rgb(232 160 32 / 0.25)",
                    }}
                  >
                    {tenant.user.email?.charAt(0).toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] truncate" style={{ color: "rgb(255 255 255 / 0.45)" }}>
                      {tenant.user.email}
                    </div>
                  </div>
                </div>
              </div>
            </aside>

            {/* ── Main content ── */}
            <main
              className="flex-1 min-h-screen overflow-y-auto"
              style={{ background: "linear-gradient(160deg, #e0dcd5 0%, #d9d4cb 50%, #d5d0c6 100%)" }}
            >
              <div className="max-w-[1020px] mx-auto px-4 md:px-8 py-8 pt-16 md:pt-8">
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
