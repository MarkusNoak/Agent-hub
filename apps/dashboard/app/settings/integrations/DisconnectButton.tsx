"use client";

import { useTransition } from "react";
import { disconnectIntegration } from "./actions";

export default function DisconnectButton({
  id,
  tenantId,
}: {
  id: string;
  tenantId: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (!window.confirm("Ta bort integration?")) return;
    const fd = new FormData();
    fd.set("id", id);
    fd.set("tenantId", tenantId);
    startTransition(async () => {
      await disconnectIntegration(fd);
    });
  }

  return (
    <button
      onClick={handleClick}
      disabled={isPending}
      className="btn btn-outline text-xs"
    >
      {isPending ? "…" : "Koppla från"}
    </button>
  );
}
