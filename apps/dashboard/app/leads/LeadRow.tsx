"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { ChevronDown, ChevronUp, ExternalLink } from "lucide-react";

type Lead = {
  id: string;
  company_name: string;
  company_domain: string | null;
  contact_name: string | null;
  contact_email: string | null;
  contact_linkedin: string | null;
  signal_type: string | null;
  signal_summary: string | null;
  offer_type: string;
  stage: string;
  score: number | null;
  created_at: string;
  updated_at: string;
};

const STAGE_COLOR: Record<string, string> = {
  new: "badge-gray",
  researched: "badge-gray",
  outreach_drafted: "badge-blue",
  outreach_sent: "badge-blue",
  replied: "badge-yellow",
  qualified: "badge-yellow",
  won: "badge-green",
  lost: "badge-red",
};

const MANUAL_STAGES = ["replied", "qualified", "won", "lost"] as const;

export function LeadRow({
  lead,
  tenantId,
  updateStageAction,
}: {
  lead: Lead;
  tenantId: string;
  updateStageAction: (fd: FormData) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);

  const contactedAt = (
    ["outreach_sent", "replied", "qualified", "won", "lost"] as string[]
  ).includes(lead.stage)
    ? lead.updated_at
    : null;

  return (
    <>
      <tr
        className="border-t border-ink-100 hover:bg-ink-50/40 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <td className="p-3">
          <div className="flex items-center gap-1.5">
            {expanded ? (
              <ChevronUp size={13} className="text-ink-400 shrink-0" />
            ) : (
              <ChevronDown size={13} className="text-ink-400 shrink-0" />
            )}
            <div>
              <div className="font-medium">{lead.company_name}</div>
              {lead.company_domain && (
                <a
                  href={`https://${lead.company_domain}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-brand hover:underline flex items-center gap-0.5"
                  onClick={(e) => e.stopPropagation()}
                >
                  {lead.company_domain}
                  <ExternalLink size={10} />
                </a>
              )}
            </div>
          </div>
        </td>
        <td className="p-3 text-xs">
          {lead.contact_name && (
            <div className="font-medium text-ink-800">{lead.contact_name}</div>
          )}
          {lead.contact_email && (
            <a
              href={`mailto:${lead.contact_email}`}
              className="text-brand hover:underline"
              onClick={(e) => e.stopPropagation()}
            >
              {lead.contact_email}
            </a>
          )}
        </td>
        <td className="p-3 text-xs text-ink-500">
          <div>{lead.signal_type ?? "—"}</div>
        </td>
        <td className="p-3">
          <span className="badge badge-blue">
            {lead.offer_type.replace(/_/g, " ")}
          </span>
        </td>
        <td className="p-3">
          {lead.score !== null ? (
            <span
              className={`font-semibold ${
                lead.score >= 8
                  ? "text-green-700"
                  : lead.score >= 5
                  ? "text-yellow-700"
                  : "text-ink-500"
              }`}
            >
              {lead.score}
            </span>
          ) : (
            <span className="text-ink-400">—</span>
          )}
        </td>
        <td className="p-3">
          <span className={`badge ${STAGE_COLOR[lead.stage] ?? "badge-gray"}`}>
            {lead.stage.replace(/_/g, " ")}
          </span>
        </td>
        <td className="p-3 text-xs text-ink-500 whitespace-nowrap">
          {contactedAt
            ? formatDistanceToNow(new Date(contactedAt), {
                addSuffix: true,
                locale: sv,
              })
            : <span className="text-ink-300">—</span>}
        </td>
        <td className="p-3 text-xs text-ink-500 whitespace-nowrap">
          {formatDistanceToNow(new Date(lead.created_at), {
            addSuffix: true,
            locale: sv,
          })}
        </td>
        <td className="p-3" onClick={(e) => e.stopPropagation()}>
          {(["outreach_sent", "replied", "qualified"] as string[]).includes(
            lead.stage,
          ) && (
            <form>
              <input type="hidden" name="leadId" value={lead.id} />
              <input type="hidden" name="tenantId" value={tenantId} />
              <select
                name="stage"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) e.target.form?.requestSubmit();
                }}
                className="text-xs border border-ink-200 rounded-lg px-2 py-1 bg-white cursor-pointer"
              >
                <option value="" disabled>
                  Flytta till…
                </option>
                {MANUAL_STAGES.filter((s) => s !== lead.stage).map((s) => (
                  <option key={s} value={s}>
                    {s.replace(/_/g, " ")}
                  </option>
                ))}
              </select>
              <button
                formAction={updateStageAction}
                type="submit"
                className="sr-only"
                aria-label="Spara stage"
              />
            </form>
          )}
        </td>
      </tr>

      {/* Expanded detail row */}
      {expanded && (
        <tr className="bg-brand-soft/30 border-t-0">
          <td colSpan={9} className="px-6 pb-4 pt-2">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-2">
                  Signal
                </div>
                <div className="font-medium">{lead.signal_type ?? "—"}</div>
                {lead.signal_summary && (
                  <p className="text-ink-600 mt-1 leading-relaxed">
                    {lead.signal_summary}
                  </p>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-2">
                  Kontakt
                </div>
                {lead.contact_name && (
                  <div className="font-medium">{lead.contact_name}</div>
                )}
                {lead.contact_email && (
                  <a
                    href={`mailto:${lead.contact_email}`}
                    className="text-brand hover:underline block"
                  >
                    {lead.contact_email}
                  </a>
                )}
                {lead.contact_linkedin && (
                  <a
                    href={lead.contact_linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-ink-500 hover:text-brand flex items-center gap-1 mt-1"
                  >
                    LinkedIn-profil <ExternalLink size={11} />
                  </a>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-ink-500 uppercase tracking-wider mb-2">
                  Erbjudande & score
                </div>
                <div>
                  <span className="badge badge-blue">
                    {lead.offer_type.replace(/_/g, " ")}
                  </span>
                </div>
                {lead.score !== null && (
                  <div className="mt-2">
                    <div className="text-xs text-ink-500 mb-1">
                      Score: {lead.score}/10
                    </div>
                    <div className="h-2 bg-ink-100 rounded-full overflow-hidden w-32">
                      <div
                        className="h-full bg-brand rounded-full"
                        style={{ width: `${(lead.score / 10) * 100}%` }}
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
