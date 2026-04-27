"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useTransition, useState } from "react";
import { Search, X } from "lucide-react";

const STAGES = [
  "new",
  "researched",
  "outreach_drafted",
  "outreach_sent",
  "replied",
  "qualified",
  "won",
  "lost",
] as const;

const OFFERS = [
  "webb_design",
  "app_development",
  "ai_automation",
  "agent_platform",
] as const;

export function LeadsFilter({ total }: { total: number }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const [search, setSearch] = useState(searchParams.get("q") ?? "");
  const stage = searchParams.get("stage") ?? "";
  const offer = searchParams.get("offer") ?? "";
  const sort = searchParams.get("sort") ?? "updated";

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  function handleSearch(val: string) {
    setSearch(val);
    const params = new URLSearchParams(searchParams.toString());
    if (val) params.set("q", val);
    else params.delete("q");
    startTransition(() => router.replace(`${pathname}?${params.toString()}`));
  }

  function clearAll() {
    setSearch("");
    startTransition(() => router.replace(pathname));
  }

  const hasFilters = !!(search || stage || offer || (sort && sort !== "updated"));

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" />
        <input
          type="text"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Sök bolag eller domän…"
          className="input pl-8 w-56"
        />
      </div>

      {/* Stage filter */}
      <select
        value={stage}
        onChange={(e) => update("stage", e.target.value)}
        className="input w-auto cursor-pointer"
      >
        <option value="">Alla stages</option>
        {STAGES.map((s) => (
          <option key={s} value={s}>
            {s.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      {/* Offer filter */}
      <select
        value={offer}
        onChange={(e) => update("offer", e.target.value)}
        className="input w-auto cursor-pointer"
      >
        <option value="">Alla erbjudanden</option>
        {OFFERS.map((o) => (
          <option key={o} value={o}>
            {o.replace(/_/g, " ")}
          </option>
        ))}
      </select>

      {/* Sort */}
      <select
        value={sort}
        onChange={(e) => update("sort", e.target.value)}
        className="input w-auto cursor-pointer"
      >
        <option value="updated">Senast uppdaterad</option>
        <option value="score_desc">Score (högt → lågt)</option>
        <option value="score_asc">Score (lågt → högt)</option>
        <option value="created">Tillagd (nyast)</option>
      </select>

      {/* Clear */}
      {hasFilters && (
        <button
          type="button"
          onClick={clearAll}
          className="btn btn-ghost text-xs gap-1"
        >
          <X size={12} />
          Rensa
        </button>
      )}

      <span className="ml-auto text-sm text-ink-500">
        {total} lead{total !== 1 ? "s" : ""}
      </span>
    </div>
  );
}
