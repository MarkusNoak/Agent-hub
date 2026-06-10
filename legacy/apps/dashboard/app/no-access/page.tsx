import { createSupabaseServerClient } from "@/lib/supabase-server";
import { redirect } from "next/navigation";

export default async function NoAccessPage() {
  const supa = createSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) redirect("/login");

  return (
    <div
      className="min-h-screen flex items-center justify-center p-8"
      style={{ background: "linear-gradient(150deg, #111009 0%, #191510 45%, #201c14 100%)" }}
    >
      <div
        className="w-full max-w-[400px] rounded-2xl p-8 text-center"
        style={{
          background: "linear-gradient(160deg, #faf7f3 0%, #f5f2ee 100%)",
        }}
      >
        <div className="w-12 h-12 rounded-xl flex items-center justify-center mx-auto mb-5"
          style={{ background: "rgb(239 68 68 / 0.1)", border: "1px solid rgb(239 68 68 / 0.2)" }}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="rgb(220 38 38)" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
        </div>
        <h1 className="text-[22px] font-bold tracking-[-0.02em] text-ink-900">
          Ingen åtkomst
        </h1>
        <p className="text-ink-400 text-sm mt-2.5 leading-relaxed">
          Kontot <span className="font-semibold text-ink-700">{user.email}</span> har
          inte tillgång till Agent Hub. Kontakta oss om du tror att det är ett misstag.
        </p>
        <div className="mt-6 space-y-2">
          <a
            href="mailto:markus.noaksson@weknowit.se"
            className="btn btn-primary w-full justify-center py-2.5 text-[14px]"
          >
            Kontakta oss
          </a>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              className="w-full text-sm text-ink-400 hover:text-ink-700 transition-colors py-2"
            >
              Logga ut
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
