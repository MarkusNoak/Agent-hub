"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";
import { useRouter } from "next/navigation";
import { Bot, ShieldCheck, BarChart3, ArrowLeft } from "lucide-react";
import { provisionTenant } from "@/app/actions/provision-tenant";

const features = [
  { Icon: Bot,         label: "Flera AI-agenter — sälj, faktura, projekt, support" },
  { Icon: ShieldCheck, label: "Alla åtgärder godkänns av dig innan de körs" },
  { Icon: BarChart3,   label: "Full insyn i varje körning och kostnad" },
];

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail]   = useState("");
  const [code, setCode]     = useState("");
  const [step, setStep]     = useState<"email" | "code">("email");
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  const supa = createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );

  async function sendCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    // No emailRedirectTo → Supabase sends a 6-digit code, immune to email link scanners.
    const { error } = await supa.auth.signInWithOtp({ email });
    setLoading(false);
    if (error) setErr(error.message);
    else setStep("code");
  }

  async function verifyCode(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setLoading(true);
    const { error } = await supa.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) {
      setLoading(false);
      setErr("Fel kod eller koden har gått ut. Begär en ny.");
      return;
    }
    // OTP flow bypasses /auth/callback, so provision tenant here.
    await provisionTenant();
    setLoading(false);
    router.push("/");
    router.refresh();
  }

  return (
    <div
      className="min-h-screen flex"
      style={{ background: "linear-gradient(150deg, #111009 0%, #191510 45%, #201c14 100%)" }}
    >
      {/* ── Left branding panel ── */}
      <div className="hidden lg:flex flex-col justify-between w-[440px] shrink-0 px-12 py-14">
        <div>
          <div className="flex items-center gap-3 mb-14">
            <div
              className="w-9 h-9 rounded-[11px] flex items-center justify-center shrink-0"
              style={{
                background: "linear-gradient(145deg, #f0b030, #e8960c)",
                boxShadow: "inset 0 1px 0 rgb(255 255 255 / 0.25), 0 2px 10px rgb(232 160 32 / 0.35)",
              }}
            >
              <svg width="17" height="17" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M14 18v3M14 6v-2" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <div>
              <div className="text-white font-bold text-[15px] tracking-[-0.01em] leading-none">weknowit</div>
              <div className="text-[11px] font-medium tracking-[0.06em] mt-[3px]" style={{ color: "rgb(232 160 32 / 0.5)" }}>
                Agent Hub
              </div>
            </div>
          </div>

          <h2 className="text-white text-[36px] font-bold tracking-[-0.03em] leading-[1.1]">
            Ditt AI-team.<br />
            <span style={{ color: "rgb(232 160 32 / 0.9)" }}>Alltid aktivt.</span>
          </h2>
          <p className="mt-5 leading-relaxed max-w-[300px]" style={{ fontSize: 14, color: "rgb(255 255 255 / 0.38)" }}>
            Agent Hub samlar dina AI-agenter på ett ställe — de sköter sälj, fakturering, projektuppföljning och support medan du fokuserar på affärerna.
          </p>
        </div>

        <div className="space-y-3">
          {features.map(({ Icon, label }) => (
            <div key={label} className="flex items-center gap-3">
              <div
                className="w-7 h-7 rounded-lg flex items-center justify-center shrink-0"
                style={{ background: "rgb(232 160 32 / 0.1)", border: "1px solid rgb(232 160 32 / 0.18)" }}
              >
                <Icon size={13} strokeWidth={2} style={{ color: "rgb(232 160 32 / 0.7)" }} />
              </div>
              <span className="text-sm" style={{ color: "rgb(255 255 255 / 0.38)" }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div
        className="flex-1 flex items-center justify-center p-8"
        style={{
          background: "linear-gradient(160deg, #faf7f3 0%, #f5f2ee 100%)",
          borderRadius: "28px 0 0 28px",
        }}
      >
        <div className="w-full max-w-[360px]">

          {/* Mobile logo */}
          <div className="flex items-center gap-2.5 mb-10 lg:hidden">
            <div
              className="w-8 h-8 rounded-[10px] flex items-center justify-center"
              style={{ background: "linear-gradient(145deg, #f0b030, #e8960c)" }}
            >
              <svg width="14" height="14" viewBox="0 0 28 28" fill="none" aria-hidden="true">
                <path d="M17 6H11.5C10.1 6 9 7.1 9 8.5C9 9.6 9.7 10.6 10.7 11L16.3 13C17.3 13.4 18 14.4 18 15.5C18 16.9 16.9 18 15.5 18H10" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
                <path d="M14 18v3M14 6v-2" stroke="#111009" strokeWidth="2.5" strokeLinecap="round"/>
              </svg>
            </div>
            <span className="font-bold text-ink-900 tracking-tight">weknowit · Agent Hub</span>
          </div>

          {step === "code" ? (
            <form onSubmit={verifyCode} className="space-y-6">
              <div>
                <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
                  Ange koden
                </h1>
                <p className="text-ink-400 text-sm mt-2.5 leading-relaxed">
                  Vi skickade en engångskod till{" "}
                  <span className="font-semibold text-ink-700">{email}</span>.
                </p>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="section-label mb-2 block">Engångskod</label>
                  <input
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6,8}"
                    maxLength={8}
                    required
                    placeholder="12345678"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 8))}
                    className="input text-center text-2xl tracking-[0.3em]"
                    autoFocus
                  />
                </div>
                {err && (
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200/80 rounded-xl px-3.5 py-2.5">
                    {err}
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loading || code.length < 6}
                  className="btn btn-primary w-full justify-center py-3 text-[15px]"
                >
                  {loading ? "Verifierar…" : "Logga in"}
                </button>
              </div>
              <button
                type="button"
                onClick={() => { setStep("email"); setCode(""); setErr(null); }}
                className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 transition-colors"
              >
                <ArrowLeft size={14} /> Byt e-postadress
              </button>
            </form>
          ) : (
            <form onSubmit={sendCode} className="space-y-6">
              <div>
                <h1 className="text-[28px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
                  Logga in
                </h1>
                <p className="text-ink-400 text-sm mt-1.5 font-medium">
                  Vi skickar en engångskod till din e-post.
                </p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="section-label mb-2 block">E-postadress</label>
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
                  <div className="text-sm text-red-700 bg-red-50 border border-red-200/80 rounded-xl px-3.5 py-2.5">
                    {err}
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading || !email}
                  className="btn btn-primary w-full justify-center py-3 text-[15px]"
                >
                  {loading ? "Skickar…" : "Skicka engångskod"}
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
