"use client";

import { useState } from "react";

export function RunNowButton({ agentKind }: { agentKind: string }) {
  const [state, setState] = useState<"idle" | "running" | "done" | "error">("idle");
  const [message, setMessage] = useState("");

  async function handleClick() {
    setState("running");
    setMessage("");
    try {
      const res = await fetch(`/api/agents/${agentKind}/trigger`, { method: "POST" });
      const json = (await res.json()) as { ok: boolean; status?: string; error?: string; runId?: string };
      if (json.ok) {
        setState("done");
        setMessage(json.status === "failed" ? `Körde klart med fel: ${json.error ?? ""}` : "Körde klart");
      } else {
        setState("error");
        setMessage(json.error ?? "Okänt fel");
      }
    } catch (e) {
      setState("error");
      setMessage((e as Error).message);
    }
    // Reset after 6 s so the button is usable again
    setTimeout(() => setState("idle"), 6000);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={state === "running"}
        className="btn btn-primary"
      >
        {state === "running" ? "Kör…" : state === "done" ? "✓ Klar" : state === "error" ? "✗ Fel" : "Run now"}
      </button>
      {message && (
        <span className={`text-xs ${state === "error" || message.startsWith("Körde klart med") ? "text-red-600" : "text-green-600"}`}>
          {message}
        </span>
      )}
    </div>
  );
}
