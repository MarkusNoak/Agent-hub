"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RunNowButton({ agentKind }: { agentKind: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "starting" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleClick() {
    setState("starting");
    setErrorMsg("");
    try {
      const res = await fetch(`/api/agents/${agentKind}/trigger`, { method: "POST" });
      const json = (await res.json()) as { started?: boolean; error?: string };
      if (!res.ok || !json.started) {
        setState("error");
        setErrorMsg(json.error ?? "Kunde inte starta agenten");
        return;
      }
      // Navigate to /runs immediately — the run continues in the background
      router.push("/runs");
    } catch (e) {
      setState("error");
      setErrorMsg((e as Error).message);
    }
    setTimeout(() => setState("idle"), 5000);
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        onClick={handleClick}
        disabled={state === "starting"}
        className="btn btn-primary"
      >
        {state === "starting" ? "Startar…" : "Run now"}
      </button>
      {state === "error" && errorMsg && (
        <span className="text-xs text-red-600">{errorMsg}</span>
      )}
    </div>
  );
}
