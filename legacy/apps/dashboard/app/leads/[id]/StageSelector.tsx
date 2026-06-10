"use client";

import { useTransition } from "react";
import { updateLeadStage } from "../actions";

const STAGES = [
  { value: "new",              label: "Ny" },
  { value: "researched",       label: "Analyserad" },
  { value: "outreach_drafted", label: "Utkast" },
  { value: "outreach_sent",    label: "Skickad" },
  { value: "replied",          label: "Svarade" },
  { value: "qualified",        label: "Kvalificerad" },
  { value: "won",              label: "Vunnen" },
  { value: "lost",             label: "Förlorad" },
];

export function StageSelector({
  leadId,
  tenantId,
  currentStage,
}: {
  leadId: string;
  tenantId: string;
  currentStage: string;
}) {
  const [isPending, startTransition] = useTransition();

  function handleChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const stage = e.target.value;
    const fd = new FormData();
    fd.set("leadId", leadId);
    fd.set("tenantId", tenantId);
    fd.set("stage", stage);
    startTransition(() => { void updateLeadStage(fd); });
  }

  return (
    <select
      defaultValue={currentStage}
      onChange={handleChange}
      disabled={isPending}
      className="input w-full"
    >
      {STAGES.map((s) => (
        <option key={s.value} value={s.value}>
          {s.label}
        </option>
      ))}
    </select>
  );
}
