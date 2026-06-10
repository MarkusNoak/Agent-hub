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
    // Fire the request — do NOT await it. The browser keeps the HTTP connection
    // alive even after navigating away (fetch is not tied to component lifecycle).
    // The Vercel lambda on the other end awaits executeAgent (up to 300 s) which
    // keeps IT alive too. This is the only pattern that works on Vercel serverless.
    fetch(`/api/agents/${agentKind}/trigger`, { method: "POST" }).catch(() => {});
    // Navigate immediately so the user can watch live status on /runs.
    router.push("/runs");
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
