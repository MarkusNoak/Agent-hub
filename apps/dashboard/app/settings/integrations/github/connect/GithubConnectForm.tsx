"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveGithub } from "./actions";

export default function GithubConnectForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      const result = await saveGithub(fd);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.push("/settings?github=connected");
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
        <span className="text-sm font-medium">Personal Access Token</span>
        <input
          type="password"
          name="token"
          required
          placeholder="ghp_..."
          autoComplete="off"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          Skapa under <strong>github.com/settings/tokens</strong> → Fine-grained tokens → repo + issues.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Organisation <span className="font-normal text-ink-500">(valfritt)</span></span>
        <input
          type="text"
          name="org"
          placeholder="t.ex. weknowit"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm"
        />
        <span className="text-xs text-ink-500">
          Om du vill söka issues och repos i en GitHub-organisation.
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
