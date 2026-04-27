"use client";

import { useRef, useState, useTransition } from "react";
import { saveAgentSettings } from "./agent-settings-actions";

interface Props {
  tenantId: string;
  currentSettings: {
    googleApiKey?: string;
    googleCseId?: string;
  };
}

export function AgentSettingsForm({ tenantId, currentSettings }: Props) {
  const formRef = useRef<HTMLFormElement>(null);
  const [isPending, startTransition] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const fd = new FormData(formRef.current!);
    startTransition(async () => {
      try {
        await saveAgentSettings(fd);
        setResult({ ok: true, message: "Inställningar sparade." });
      } catch (err) {
        setResult({ ok: false, message: (err as Error).message });
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="space-y-4">
      <input type="hidden" name="tenantId" value={tenantId} />

      <div>
        <h3 className="text-sm font-semibold mb-3">Google Custom Search (Sales Agent)</h3>
        <p className="text-xs text-ink-500 mb-3">
          Krävs för källan <code>search_weak_digital_presence</code>. Skapa ett Custom Search-motor
          på{" "}
          <a
            href="https://programmablesearchengine.google.com"
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand underline"
          >
            programmablesearchengine.google.com
          </a>{" "}
          och aktivera "Search the entire web". API-nyckeln hittar du i Google Cloud Console.
        </p>

        <div className="space-y-3">
          <label className="block space-y-1">
            <span className="text-sm font-medium">Google API Key</span>
            <input
              type="password"
              name="googleApiKey"
              defaultValue={currentSettings.googleApiKey ?? ""}
              placeholder="AIzaSy..."
              autoComplete="off"
              className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-sm font-medium">Custom Search Engine ID (cx)</span>
            <input
              type="text"
              name="googleCseId"
              defaultValue={currentSettings.googleCseId ?? ""}
              placeholder="017576662512468239146:omuauf_lfve"
              className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
            />
            <span className="text-xs text-ink-500">
              Finns under "Basics" i din sökmotors inställningar.
            </span>
          </label>
        </div>
      </div>

      {result && (
        <p className={`text-sm ${result.ok ? "text-green-600" : "text-red-600"}`}>
          {result.message}
        </p>
      )}

      <button type="submit" disabled={isPending} className="btn btn-primary">
        {isPending ? "Sparar…" : "Spara agent-inställningar"}
      </button>
    </form>
  );
}
