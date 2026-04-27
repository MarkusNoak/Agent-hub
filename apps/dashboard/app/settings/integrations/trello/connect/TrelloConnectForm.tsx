"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveTrello } from "./actions";

export default function TrelloConnectForm({ tenantId }: { tenantId: string }) {
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
        await saveTrello(fd);
        router.push("/settings?trello=connected");
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
        <span className="text-sm font-medium">API Key</span>
        <input
          type="text"
          name="api_key"
          required
          placeholder="din Trello API Key"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          Hämtas från <strong>trello.com/app-key</strong>.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Token</span>
        <input
          type="password"
          name="token"
          required
          placeholder="din Trello Token"
          autoComplete="off"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          På samma sida: klicka <strong>Generate a Token</strong> → godkänn → kopiera.
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
