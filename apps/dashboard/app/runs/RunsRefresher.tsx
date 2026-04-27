"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Automatically refreshes the page every 5 s while hasRunning is true. */
export function RunsRefresher({ hasRunning }: { hasRunning: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!hasRunning) return;
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [hasRunning, router]);

  return null;
}
