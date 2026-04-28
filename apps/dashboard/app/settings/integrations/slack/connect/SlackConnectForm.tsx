"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSlack } from "./actions";

export default function SlackConnectForm({ tenantId }: { tenantId: string }) {
  const formRef = useRef<HTMLFormElement>(null);
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      const result = await saveSlack(fd);
      if (!result.ok) {
        setError(result.error);
      } else {
        router.push("/settings?slack=connected");
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
        <span className="text-sm font-medium">Incoming Webhook URL</span>
        <input
          type="url"
          name="webhook_url"
          required
          placeholder="https://hooks.slack.com/services/T.../B.../..."
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          Skapas i din Slack-app under Features → Incoming Webhooks. Välj kanal/grupp dit notiser ska skickas.
        </span>
      </label>

      <label className="block space-y-1">
        <span className="text-sm font-medium">Bot Token <span className="font-normal text-ink-500">(valfritt — för avancerade funktioner)</span></span>
        <input
          type="password"
          name="bot_token"
          placeholder="xoxb-..."
          autoComplete="off"
          className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
        />
        <span className="text-xs text-ink-500">
          Krävs bara om du vill att agenter ska kunna söka efter användare eller posta i specifika kanaler.
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <button type="submit" disabled={isPending} className="btn btn-primary">
          {isPending ? "Testar…" : "Test & spara"}
        </button>
        <a href="/settings" className="btn btn-secondary">Avbryt</a>
      </div>
    </form>
  );
}
