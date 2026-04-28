"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveClockify } from "./actions";

export default function ClockifyConnectForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      const result = await saveClockify(fd);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.push("/settings?clockify=connected");
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
        <span className="text-sm font-medium">API-nyckel</span>
        <input
          type="password"
          name="api_key"
          required
          placeholder="din Clockify API-nyckel"
          autoComplete="off"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          Hämtas från <strong>clockify.me/user/settings</strong> → API → Generate.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Workspace ID</span>
        <input
          type="text"
          name="workspace_id"
          required
          placeholder="60e2b5f1..."
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          Finns i URL:en när du är inne i workspacet: clockify.me/tracker/<strong>WORKSPACE_ID</strong>
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? "Verifierar…" : "Test & spara"}
        </button>
        <a href="/settings" className="btn btn-secondary">Avbryt</a>
      </div>
    </form>
  );
}
