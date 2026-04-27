"use client";

import { useState, useTransition } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { saveAgentConfig } from "./actions";

export function AgentConfigPanel({
  agentId,
  tenantId,
  agentKind,
  currentCron,
  currentSystemPrompt,
}: {
  agentId: string;
  tenantId: string;
  agentKind: string;
  currentCron: string;
  currentSystemPrompt: string;
}) {
  const [open, setOpen] = useState(false);
  const [cron, setCron] = useState(currentCron);
  const [prompt, setPrompt] = useState(currentSystemPrompt);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleSave() {
    setError(null);
    setSaved(false);
    const fd = new FormData();
    fd.set("agentId", agentId);
    fd.set("tenantId", tenantId);
    fd.set("cron", cron);
    fd.set("systemPrompt", prompt);
    startTransition(async () => {
      try {
        await saveAgentConfig(fd);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  return (
    <div className="mt-4 border-t border-ink-100">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 mt-3 text-xs text-ink-500 hover:text-ink-800 transition-colors"
      >
        {open ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {open ? "Dölj konfiguration" : "Konfiguration (schema · systempromt)"}
      </button>

      {open && (
        <div className="mt-4 space-y-4">
          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-600">
              Cron-schema{" "}
              <span className="font-normal text-ink-400">(lämna tomt för händelsestyrd)</span>
            </label>
            <input
              type="text"
              value={cron}
              onChange={(e) => setCron(e.target.value)}
              placeholder="0 9 * * 1-5"
              className="input font-mono"
            />
            <p className="text-xs text-ink-400">
              Exempel: <code>0 9 * * 1-5</code> = mån–fre kl. 09:00
            </p>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-semibold text-ink-600">
              System-prompt-override{" "}
              <span className="font-normal text-ink-400">(lämna tomt för att använda default)</span>
            </label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={8}
              placeholder={`Lämna tomt för agentens inbyggda systempromt.\n\nOm du fyller i text här används den som systempromt för ${agentKind}-agenten.`}
              className="input resize-y font-mono text-xs leading-relaxed"
            />
          </div>

          {error && (
            <p className="text-sm text-red-600 bg-red-50 border border-red-100 rounded-xl p-3">
              {error}
            </p>
          )}

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleSave}
              disabled={isPending}
              className="btn btn-primary"
            >
              {isPending ? "Sparar…" : "Spara"}
            </button>
            {saved && (
              <span className="text-sm text-green-700 font-medium">✓ Sparat</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
