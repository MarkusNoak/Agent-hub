"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { ChevronDown, ExternalLink, Mail, Linkedin } from "lucide-react";
import { updateLeadStage } from "./actions";

type Lead = {
  id: string;
  company_name: string | null;
  company_domain: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  signal_type: string | null;
  signal_summary: string | null;
  offer_type: string | null;
  stage: string | null;
  score: number | null;
  created_at: string | null;
  updated_at: string | null;
};

const STAGE_COLOR: Record<string, string> = {
  new:              "badge-gray",
  researched:       "badge-gray",
  outreach_drafted: "badge-blue",
  outreach_sent:    "badge-blue",
  replied:          "badge-yellow",
  qualified:        "badge-yellow",
  won:              "badge-green",
  lost:             "badge-red",
};

const STAGE_LABEL: Record<string, string> = {
  new:              "Ny",
  researched:       "Analyserad",
  outreach_drafted: "Utkast",
  outreach_sent:    "Skickad",
  replied:          "Svarade",
  qualified:        "Kvalificerad",
  won:              "Vunnen",
  lost:             "Förlorad",
};

const OFFER_LABEL: Record<string, string> = {
  webb_design:      "Webbdesign",
  app_development:  "Apputveckling",
  ai_automation:    "AI-automation",
  agent_platform:   "Agent Platform",
};

const MANUAL_STAGES = ["replied", "qualified", "won", "lost"] as const;

function fmt(dateStr: string | null | undefined) {
  if (!dateStr) return null;
  try {
    return formatDistanceToNow(new Date(dateStr), { addSuffix: true, locale: sv });
  } catch {
    return null;
  }
}

export function LeadRow({ lead, tenantId }: { lead: Lead; tenantId: string }) {
  const [expanded, setExpanded] = useState(false);
  const [pending, startTransition] = useTransition();

  const stage = lead.stage ?? "";
  const contactedAt =
    ["outreach_sent", "replied", "qualified", "won", "lost"].includes(stage)
      ? lead.updated_at
      : null;

  const scoreNum = lead.score ?? null;
  const scoreColor =
    scoreNum === null  ? "text-ink-300"
    : scoreNum >= 8    ? "text-emerald-600"
    : scoreNum >= 5    ? "text-amber-600"
    :                    "text-ink-400";

  function handleStageChange(newStage: string) {
    if (!newStage) return;
    const fd = new FormData();
    fd.set("leadId", lead.id);
    fd.set("tenantId", tenantId);
    fd.set("stage", newStage);
    startTransition(() => { void updateLeadStage(fd); });
  }

  return (
    <>
      <tr
        className={`cursor-pointer transition-colors ${expanded ? "bg-brand-muted/70" : "hover:bg-brand-muted/40"} ${pending ? "opacity-60" : ""}`}
        onClick={() => setExpanded((e) => !e)}
      >
        {/* Company */}
        <td className="py-3 px-4 border-b border-ink-100/70">
          <div className="flex items-center gap-2">
            <ChevronDown
              size={13}
              className={`text-ink-300 shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`}
            />
            <div>
              <div className="font-semibold text-ink-900 text-sm leading-tight">
                {lead.company_name ?? <span className="text-ink-300">—</span>}
              </div>
              {lead.company_domain && (
                <a
                  href={`https://${lead.company_domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 text-[11px] text-brand hover:underline mt-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {lead.company_domain}
                  <ExternalLink size={9} />
                </a>
              )}
            </div>
          </div>
        </td>

        {/* Contact */}
        <td className="py-3 px-4 border-b border-ink-100/70">
          <div className="text-sm text-ink-700 font-medium leading-tight">
            {lead.contact_name ?? <span className="text-ink-300 text-xs">—</span>}
          </div>
          {lead.contact_email && (
            <a
              href={`mailto:${lead.contact_email}`}
              className="text-[11px] text-brand hover:underline block mt-0.5"
              onClick={(e) => e.stopPropagation()}
            >
              {lead.contact_email}
            </a>
          )}
        </td>

        {/* Signal */}
        <td className="py-3 px-4 border-b border-ink-100/70">
          <span className="text-xs text-ink-500 font-medium">
            {lead.signal_type ?? <span className="text-ink-300">—</span>}
          </span>
        </td>

        {/* Offer */}
        <td className="py-3 px-4 border-b border-ink-100/70">
          <span className="badge badge-blue">
            {OFFER_LABEL[lead.offer_type ?? ""] ?? (lead.offer_type ?? "—").replace(/_/g, " ")}
          </span>
        </td>

        {/* Score */}
        <td className="py-3 px-4 border-b border-ink-100/70 text-center">
          {scoreNum !== null ? (
            <span className={`text-sm font-bold tabular-nums ${scoreColor}`}>{scoreNum}</span>
          ) : (
            <span className="text-ink-300 text-sm">—</span>
          )}
        </td>

        {/* Stage */}
        <td className="py-3 px-4 border-b border-ink-100/70">
          <span className={`badge ${STAGE_COLOR[stage] ?? "badge-gray"}`}>
            {STAGE_LABEL[stage] ?? (stage.replace(/_/g, " ") || "—")}
          </span>
        </td>

        {/* Contacted */}
        <td className="py-3 px-4 border-b border-ink-100/70 text-xs text-ink-400 whitespace-nowrap">
          {fmt(contactedAt) ?? <span className="text-ink-200">—</span>}
        </td>

        {/* Added */}
        <td className="py-3 px-4 border-b border-ink-100/70 text-xs text-ink-400 whitespace-nowrap">
          {fmt(lead.created_at) ?? "—"}
        </td>

        {/* Action */}
        <td
          className="py-3 px-4 border-b border-ink-100/70"
          onClick={(e) => e.stopPropagation()}
        >
          {["outreach_sent", "replied", "qualified"].includes(stage) && (
            <select
              defaultValue=""
              disabled={pending}
              onChange={(e) => handleStageChange(e.target.value)}
              className="text-xs border border-ink-200 rounded-lg px-2 py-1.5 bg-white cursor-pointer hover:border-brand transition-colors outline-none focus:ring-2 focus:ring-brand/20"
            >
              <option value="" disabled>Flytta…</option>
              {MANUAL_STAGES.filter((s) => s !== stage).map((s) => (
                <option key={s} value={s}>{STAGE_LABEL[s]}</option>
              ))}
            </select>
          )}
        </td>
      </tr>

      {/* Expanded detail */}
      {expanded && (
        <tr>
          <td
            colSpan={9}
            className="px-5 pb-5 pt-3 border-b border-ink-100/70 bg-brand-muted/40"
          >
            <div className="ml-[21px] grid grid-cols-1 md:grid-cols-3 gap-6 text-sm">

              {/* Signal */}
              <div>
                <div className="section-label mb-2">Signal</div>
                <div className="font-semibold text-ink-800">{lead.signal_type ?? "—"}</div>
                {lead.signal_summary && (
                  <p className="text-ink-500 mt-1.5 leading-relaxed text-xs">
                    {lead.signal_summary}
                  </p>
                )}
              </div>

              {/* Contact */}
              <div>
                <div className="section-label mb-2">Kontakt</div>
                {lead.contact_name && (
                  <div className="font-semibold text-ink-800">{lead.contact_name}</div>
                )}
                {lead.contact_email && (
                  <a
                    href={`mailto:${lead.contact_email}`}
                    className="inline-flex items-center gap-1 text-brand hover:underline text-xs mt-1"
                  >
                    <Mail size={11} />{lead.contact_email}
                  </a>
                )}
                {lead.contact_linkedin && (
                  <a
                    href={lead.contact_linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-ink-500 hover:text-brand text-xs mt-1 block"
                  >
                    <Linkedin size={11} />LinkedIn-profil
                  </a>
                )}
                {!lead.contact_name && !lead.contact_email && !lead.contact_linkedin && (
                  <span className="text-ink-300 text-xs">Ingen kontaktinfo</span>
                )}
              </div>

              {/* Offer & score */}
              <div>
                <div className="section-label mb-2">Erbjudande & score</div>
                <span className="badge badge-blue">
                  {OFFER_LABEL[lead.offer_type ?? ""] ?? (lead.offer_type ?? "—").replace(/_/g, " ")}
                </span>
                {scoreNum !== null && (
                  <div className="mt-3">
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-ink-400">Score</span>
                      <span className={`font-bold tabular-nums ${scoreColor}`}>{scoreNum}/10</span>
                    </div>
                    <div className="h-1.5 bg-ink-100 rounded-full overflow-hidden w-full">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{
                          width: `${(scoreNum / 10) * 100}%`,
                          background: scoreNum >= 8
                            ? "linear-gradient(90deg, #10b981, #34d399)"
                            : scoreNum >= 5
                            ? "linear-gradient(90deg, #e8a020, #f0b840)"
                            : "#9ca3af",
                        }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
