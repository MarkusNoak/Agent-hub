"use client";

import { useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { NavLinks } from "./NavLinks";

type Role = "owner" | "admin" | "approver" | "viewer";

export function MobileSidebar({
  tenantName,
  tenantPlan,
  tenantInitial,
  userEmail,
  role = "owner",
}: {
  tenantName: string;
  tenantPlan: string;
  tenantInitial: string;
  userEmail: string;
  role?: Role;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close drawer on navigation
  useEffect(() => { setOpen(false); }, [pathname]);

  // Lock body scroll when open
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => { document.body.style.overflow = ""; };
  }, [open]);

  return (
    <>
      {/* Hamburger button — only visible on mobile */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="md:hidden fixed top-4 left-4 z-40 w-9 h-9 flex items-center justify-center rounded-xl"
        style={{
          background: "linear-gradient(145deg, #151210 0%, #111009 100%)",
          boxShadow: "0 2px 8px rgb(0 0 0 / 0.25)",
        }}
        aria-label="Öppna meny"
      >
        <Menu size={16} style={{ color: "rgb(255 255 255 / 0.7)" }} />
      </button>

      {/* Backdrop */}
      {open && (
        <div
          className="md:hidden fixed inset-0 z-40 bg-black/50 backdrop-blur-sm"
          onClick={() => setOpen(false)}
        />
      )}

      {/* Drawer */}
      <aside
        className="md:hidden fixed inset-y-0 left-0 z-50 w-[228px] flex flex-col transition-transform duration-300"
        style={{
          background: "linear-gradient(180deg, #151210 0%, #111009 40%, #0e0d08 100%)",
          borderRight: "1px solid rgb(255 255 255 / 0.05)",
          transform: open ? "translateX(0)" : "translateX(-100%)",
        }}
      >
        {/* Close button */}
        <div className="flex items-center justify-between px-4 pt-4 pb-3">
          <div className="flex items-center gap-2">
            <svg width="22" height="22" viewBox="0 0 36 36" fill="none" aria-hidden="true" className="shrink-0">
              <path d="M20 6L9 18L20 30" stroke="#f0b030" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M29 6L18 18L29 30" stroke="#f0b030" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" opacity="0.5"/>
            </svg>
            <span className="text-white font-bold text-[14px] tracking-[-0.02em]">weknowit</span>
          </div>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors hover:bg-white/10"
            aria-label="Stäng meny"
          >
            <X size={14} style={{ color: "rgb(255 255 255 / 0.5)" }} />
          </button>
        </div>

        {/* Separator */}
        <div className="mx-5 h-px mb-1" style={{ background: "rgb(255 255 255 / 0.06)" }} />

        {/* Workspace badge */}
        <div className="px-5 py-3">
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
              {tenantInitial}
            </div>
            <div className="min-w-0">
              <div className="text-[12px] font-semibold truncate" style={{ color: "rgb(255 255 255 / 0.88)" }}>{tenantName}</div>
              <div className="text-[10px] capitalize" style={{ color: "rgb(232 160 32 / 0.5)" }}>{tenantPlan}</div>
            </div>
          </div>
        </div>

        <div className="mx-5 h-px mb-1" style={{ background: "rgb(255 255 255 / 0.06)" }} />

        <NavLinks role={role} />

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
              {tenantInitial}
            </div>
            <div className="min-w-0">
              <div className="text-[11px] truncate" style={{ color: "rgb(255 255 255 / 0.45)" }}>
                {userEmail}
              </div>
            </div>
          </div>
        </div>
      </aside>
    </>
  );
}
