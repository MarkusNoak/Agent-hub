"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveLinkedIn } from "./actions";

export default function LinkedInConnectForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      const result = await saveLinkedIn(fd);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.push("/settings?linkedin=connected");
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
        <span className="text-sm font-medium">Access Token</span>
        <input
          type="password"
          name="access_token"
          required
          autoComplete="off"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Author URN</span>
        <input
          type="text"
          name="author_urn"
          required
          placeholder="urn:li:person:ABC123..."
          className="w-full border border-ink-200 rounded-lg p-2 text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Kontonamn (valfritt)</span>
        <input
          type="text"
          name="label"
          placeholder="t.ex. Markus — We Know IT"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm"
        />
      </label>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? "Ansluter…" : "Anslut"}
        </button>
        <a href="/settings" className="btn btn-secondary">
          Avbryt
        </a>
      </div>
    </form>
  );
}
