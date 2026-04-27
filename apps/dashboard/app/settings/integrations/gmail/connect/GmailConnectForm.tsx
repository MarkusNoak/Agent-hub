"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGmailSmtp } from "./actions";

export default function GmailConnectForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      try {
        await saveGmailSmtp(fd);
        router.push("/settings?gmail=connected");
      } catch (err) {
        setError((err as Error).message);
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="card p-5 space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <label className="block space-y-1">
        <span className="text-sm font-medium">Avsändaradress</span>
        <input
          type="email"
          name="from"
          required
          placeholder="markus@weknowit.nu"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm"
        />
        <span className="text-xs text-ink-500">
          Gmail eller Google Workspace (.se, .nu, .com etc.) — det du loggar in med på Google.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">App Password</span>
        <input
          type="password"
          name="password"
          required
          placeholder="xxxx xxxx xxxx xxxx"
          autoComplete="off"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          16 tecken från myaccount.google.com/apppasswords. Sparas krypterat.
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? "Testar…" : "Test & save"}
        </button>
        <a href="/settings" className="btn btn-secondary">
          Cancel
        </a>
      </div>
    </form>
  );
}
