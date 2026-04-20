"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function signIn(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    const supa = createBrowserClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    );
    const { error } = await supa.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${location.origin}/auth/callback` },
    });
    if (error) setErr(error.message);
    else setSent(true);
  }

  return (
    <div className="min-h-screen flex items-center justify-center">
      <form onSubmit={signIn} className="card p-8 max-w-md w-full space-y-4">
        <h1 className="text-2xl font-semibold">Sign in to Agent Hub</h1>
        {sent ? (
          <p className="text-ink-500">Magic link sent to {email}. Check your inbox.</p>
        ) : (
          <>
            <input
              type="email"
              required
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-ink-200 rounded-lg"
            />
            {err && <div className="text-red-600 text-sm">{err}</div>}
            <button type="submit" className="btn btn-primary w-full justify-center">
              Send magic link
            </button>
          </>
        )}
      </form>
    </div>
  );
}
