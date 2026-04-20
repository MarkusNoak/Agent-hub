"use client";

import { useState } from "react";
import { createBrowserClient } from "@supabase/ssr";

type Role = "owner" | "admin" | "approver" | "viewer";

type InviteResponse = {
  email: string;
  role: Role;
  tenant: { slug: string; name: string };
  invite_url: string;
  user_created: boolean;
  expires_in_hours: number;
};

export function InviteUserForm({
  tenantSlug,
  callerRole,
}: {
  tenantSlug: string;
  callerRole: Role;
}) {
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("admin");
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<InviteResponse | null>(null);
  const [copied, setCopied] = useState(false);

  const canGrantOwner = callerRole === "owner";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setResult(null);
    setLoading(true);

    try {
      const supa = createBrowserClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      );
      const { data: sess } = await supa.auth.getSession();
      const token = sess.session?.access_token;
      if (!token) {
        setErr("No active session. Please sign in again.");
        setLoading(false);
        return;
      }

      const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/invite-user`;
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email, role, tenantSlug }),
      });

      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErr(json?.error ?? `HTTP ${res.status}`);
        setLoading(false);
        return;
      }

      setResult(json as InviteResponse);
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  async function copyInviteUrl() {
    if (!result) return;
    await navigator.clipboard.writeText(result.invite_url);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function reset() {
    setResult(null);
    setEmail("");
    setRole("admin");
    setErr(null);
  }

  if (result) {
    return (
      <div className="space-y-3">
        <div className="text-sm text-ink-900">
          Invite link for <span className="font-medium">{result.email}</span> as{" "}
          <span className="font-medium">{result.role}</span> on{" "}
          <span className="font-medium">{result.tenant.name}</span>.{" "}
          {result.user_created ? "New user created." : "Existing user."} Expires in{" "}
          {result.expires_in_hours}h.
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            readOnly
            value={result.invite_url}
            className="flex-1 px-3 py-2 border border-ink-200 rounded-lg text-xs font-mono bg-ink-50"
            onFocus={(e) => e.currentTarget.select()}
          />
          <button type="button" onClick={copyInviteUrl} className="btn btn-primary">
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <div className="text-xs text-ink-500">
          Share this link via Slack or email. The recipient clicks it and is signed in
          directly - no password needed.
        </div>
        <button type="button" onClick={reset} className="btn btn-secondary">
          Generate another
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-[1fr_160px_auto] gap-2">
        <input
          type="email"
          required
          placeholder="colleague@company.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="px-3 py-2 border border-ink-200 rounded-lg"
          disabled={loading}
        />
        <select
          value={role}
          onChange={(e) => setRole(e.target.value as Role)}
          className="px-3 py-2 border border-ink-200 rounded-lg bg-white"
          disabled={loading}
        >
          <option value="viewer">Viewer</option>
          <option value="approver">Approver</option>
          <option value="admin">Admin</option>
          {canGrantOwner && <option value="owner">Owner</option>}
        </select>
        <button type="submit" className="btn btn-primary" disabled={loading}>
          {loading ? "Generating..." : "Generate invite link"}
        </button>
      </div>
      {err && <div className="text-red-600 text-sm">{err}</div>}
      <div className="text-xs text-ink-500">
        Creates the user (if needed), adds them to this tenant, and returns a magic
        link you can share manually. No email is sent.
      </div>
    </form>
  );
}
