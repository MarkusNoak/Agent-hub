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
                  <svg width="26" height="26" viewBox="0 0 36 36" fill="none" aria-hidden="true" className="shrink-0">
                    <path d="M20 6L9 18L20 30" stroke="#f0b030" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M29 6L18 18L29 30" stroke="#f0b030" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
                  </svg>
                  <div>
                    <div className="text-white font-bold text-[15px] tracking-[-0.02em] leading-none">weknowit</div>
                    <div className="text-[10px] font-medium mt-[3px] tracking-[0.06em]" style={{ color: "rgb(232 160 32 / 0.5)" }}>Agent Hub</div>
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
