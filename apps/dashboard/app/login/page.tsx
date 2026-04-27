"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const supa = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    setLoading(false);
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ background: "linear-gradient(135deg, #111009 0%, #1e1a12 50%, #2a231a 100%)" }}
    >
      {/* Left — branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-[420px] shrink-0 p-12">
        <div>
          {/* Logo */}
          <div className="flex items-center gap-3 mb-16">
            <div className="w-9 h-9 rounded-xl bg-brand flex items-center justify-center shrink-0">
              <svg width="18" height="18" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M14 18v3M14 6v-2" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-bold text-base tracking-tight">weknowit</div>
              <div className="text-brand/50 text-[11px] font-medium tracking-wide mt-0.5">Agent Hub</div>
            </div>
          </div>

          <h2 className="text-white text-[32px] font-bold tracking-[-0.02em] leading-snug">
            Din AI-sälj&shy;avdelning.<br />
            Alltid aktiv.
          </h2>
          <p className="text-white/40 text-sm mt-4 leading-relaxed max-w-xs">
            Agent Hub hittar leads, skriver outreach och håller kunder uppdaterade — medan du fokuserar på det som skapar affärer.
          </p>
        </div>

        {/* Features */}
        <div className="space-y-3">
          {[
            { icon: "🎯", label: "Sales agent — leads på autopilot" },
            { icon: "✉️", label: "Outreach godkänns av dig innan sändning" },
            { icon: "📊", label: "Full insyn i varje körning och kostnad" },
          ].map((f) => (
            <div key={f.label} className="flex items-center gap-3 text-sm text-white/40">
              <span>{f.icon}</span>
              <span>{f.label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Right — login form */}
      <div className="flex-1 flex items-center justify-center p-6 bg-[#f7f4f0]" style={{borderRadius: "24px 0 0 24px"}}>
        <div className="w-full max-w-[380px] space-y-8">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 lg:hidden">
            <div className="w-8 h-8 rounded-lg bg-[#111009] flex items-center justify-center">
              <svg width="14" height="14" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#e8a020" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M14 18v3M14 6v-2" stroke="#e8a020" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="font-bold text-ink-900">weknowit · Agent Hub</span>
          </div>

          {sent ? (
            <div className="space-y-4">
              <div className="w-12 h-12 rounded-2xl bg-emerald-100 flex items-center justify-center text-emerald-600 text-xl">✓</div>
              <div>
                <h1 className="text-[24px] font-bold tracking-[-0.02em] text-ink-900">Kolla din inbox</h1>
                <p className="text-ink-400 text-sm mt-2 leading-relaxed">
                  Vi skickade en inloggningslänk till <span className="font-semibold text-ink-700">{email}</span>. Klicka på länken i mejlet för att logga in.
                </p>
              </div>
              <button
                type="button"
                onClick={() => { setSent(false); setEmail(""); }}
                className="text-sm text-ink-400 hover:text-ink-700 transition-colors"
              >
                ← Försök med en annan e-postadress
              </button>
            </div>
          ) : (
            <form onSubmit={signIn} className="space-y-5">
              <div>
                <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
                  Logga in
                </h1>
                <p className="text-ink-400 text-sm mt-1 font-medium">
                  Vi skickar en magisk länk till din e-post.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="section-label mb-1.5 block">E-postadress</label>
                  <input
                    type="email"
                    required
                    placeholder="du@foretaget.se"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="input"
                    autoFocus
                  />
                </div>

                {err && (
                  <div className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl px-3 py-2.5">
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="btn btn-primary w-full justify-center py-2.5 text-base"
                >
                  {loading ? "Skickar…" : "Skicka inloggningslänk"}
                </button>
              </div>

              <p className="text-xs text-ink-300 text-center">
                Inga lösenord. Inget krångel.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
