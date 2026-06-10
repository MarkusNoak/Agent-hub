import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";
import { notFound } from "next/navigation";
import Link from "next/link";
import { format, formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import {
  ArrowLeft, ExternalLink, Mail, Linkedin, Globe,
  CheckCircle2, XCircle, Clock, Send,
} from "lucide-react";
import { StageSelector } from "./StageSelector";

export const dynamic = "force-dynamic";

const STAGE_LABEL: Record<string, string> = {
  new: "Ny", researched: "Analyserad", outreach_drafted: "Utkast",
  outreach_sent: "Skickad", replied: "Svarade", qualified: "Kvalificerad",
  won: "Vunnen", lost: "Förlorad",
};

const STAGE_COLOR: Record<string, string> = {
  new: "badge-gray", researched: "badge-gray",
  outreach_drafted: "badge-blue", outreach_sent: "badge-blue",
  replied: "badge-yellow", qualified: "badge-yellow",
  won: "badge-green", lost: "badge-red",
};

const OFFER_LABEL: Record<string, string> = {
  webb_design: "Webbdesign", app_development: "Apputveckling",
  ai_automation: "AI-automation", agent_platform: "Agent Platform",
  upsell: "Upsell",
};

const STAGE_ORDER = [
  "new", "researched", "outreach_drafted", "outreach_sent",
  "replied", "qualified", "won",
];

function scoreColor(s: number) {
  if (s >= 8) return { text: "text-emerald-600", bar: "linear-gradient(90deg,#10b981,#34d399)" };
  if (s >= 5) return { text: "text-amber-600",   bar: "linear-gradient(90deg,#e8a020,#f0b840)" };
  return         { text: "text-ink-400",          bar: "#9ca3af" };
}

export default async function LeadDetailPage({
  params,
}: {
  params: { id: string };
}) {
  const tenant = await getActiveTenant();
  if (!tenant) return null;
  const supa = createSupabaseServerClient();

  const { data: lead } = await supa
    .from("leads")
    .select("*")
    .eq("id", params.id)
    .eq("tenant_id", tenant.id)
    .single();

  if (!lead) notFound();

  // All outreach drafts / approvals tied to this lead
  const { data: approvals } = await supa
    .from("approval_queue")
    .select("id, status, action, title, summary, payload, created_at, approved_at, rejection_reason")
    .eq("tenant_id", tenant.id)
    .contains("payload", { lead_id: params.id })
    .order("created_at", { ascending: false });

  const stage = (lead.stage as string) ?? "new";
  const score = (lead.score as number | null);
  const meta  = (lead.metadata as Record<string, unknown>) ?? {};
  const pains = (meta["detected_pains"] as string[] | undefined) ?? [];
  const source = (meta["source"] as string | undefined) ?? null;
  const currentStepIdx = STAGE_ORDER.indexOf(stage);

  const sc = score !== null ? scoreColor(score) : null;

  return (
    <div className="space-y-6">

      {/* Back */}
      <Link
        href="/leads"
        className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-700 transition-colors"
      >
        <ArrowLeft size={14} /> Alla leads
      </Link>

      {/* ── Header ── */}
      <div className="card p-6">
        <div className="flex items-start justify-between gap-6 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap mb-1">
              <h1 className="text-[26px] font-bold tracking-[-0.02em] text-ink-900 leading-tight">
                {(lead.company_name as string | null) ?? "—"}
              </h1>
              <span className={`badge ${STAGE_COLOR[stage] ?? "badge-gray"}`}>
                {STAGE_LABEL[stage] ?? stage}
              </span>
              {(lead.offer_type as string | null) && (
                <span className="badge badge-blue">
                  {OFFER_LABEL[lead.offer_type as string] ?? (lead.offer_type as string)}
                </span>
              )}
            </div>

            {(lead.company_domain as string | null) && (
              <a
                href={`https://${lead.company_domain}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-brand hover:underline mt-1"
              >
                <Globe size={13} />
                {lead.company_domain as string}
                <ExternalLink size={11} />
              </a>
            )}
          </div>

          {/* Score */}
          {score !== null && sc && (
            <div className="text-right shrink-0">
              <div className={`text-[42px] font-extrabold tracking-[-0.04em] leading-none tabular-nums ${sc.text}`}>
                {score}
              </div>
              <div className="text-xs text-ink-400 font-medium mt-1">ICP-score / 10</div>
              <div className="mt-2 w-24 h-1.5 bg-ink-100 rounded-full overflow-hidden ml-auto">
                <div className="h-full rounded-full" style={{ width: `${(score / 10) * 100}%`, background: sc.bar }} />
              </div>
            </div>
          )}
        </div>

        {/* Stage progress bar */}
        <div className="mt-6 pt-5 border-t border-ink-100">
          <div className="section-label mb-3">Pipeline</div>
          <div className="flex items-center gap-0">
            {STAGE_ORDER.map((s, i) => {
              const isPast    = i < currentStepIdx;
              const isCurrent = i === currentStepIdx;
              const isWon     = stage === "won" && s === "won";
              return (
                <div key={s} className="flex items-center flex-1 min-w-0">
                  <div className="flex flex-col items-center flex-1">
                    <div
                      className="w-2 h-2 rounded-full mb-1 flex-shrink-0"
                      style={{
                        background: isWon       ? "#10b981"
                          : isCurrent ? "#e8a020"
                          : isPast    ? "rgb(0 0 0 / 0.2)"
                          : "rgb(0 0 0 / 0.08)",
                        boxShadow: isCurrent ? "0 0 0 3px rgb(232 160 32 / 0.2)" : undefined,
                      }}
                    />
                    <span
                      className="text-[9px] font-medium text-center leading-tight px-0.5"
                      style={{
                        color: isCurrent ? "#111009"
                          : isPast  ? "rgb(0 0 0 / 0.35)"
                          : "rgb(0 0 0 / 0.2)",
                        fontWeight: isCurrent ? 700 : 500,
                      }}
                    >
                      {STAGE_LABEL[s]}
                    </span>
                  </div>
                  {i < STAGE_ORDER.length - 1 && (
                    <div
                      className="h-px flex-1 mb-3 mx-0.5"
                      style={{ background: i < currentStepIdx ? "rgb(0 0 0 / 0.15)" : "rgb(0 0 0 / 0.06)" }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* ── Left: Signal + Outreach ── */}
        <div className="lg:col-span-2 space-y-4">

          {/* Signal */}
          {((lead.signal_type as string | null) || (lead.signal_summary as string | null)) && (
            <div className="card p-5">
              <div className="section-label mb-3">Signal</div>
              {(lead.signal_type as string | null) && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-brand-soft border border-brand/20 text-sm font-semibold text-brand mb-3">
                  {(lead.signal_type as string).replace(/_/g, " ")}
                </div>
              )}
              {(lead.signal_summary as string | null) && (
                <p className="text-sm text-ink-600 leading-relaxed">
                  {lead.signal_summary as string}
                </p>
              )}
            </div>
          )}

          {/* Outreach history */}
          <div className="card overflow-hidden">
            <div className="px-5 py-4 border-b border-ink-100">
              <div className="section-label">Outreach-historik</div>
              <p className="text-xs text-ink-400 mt-0.5">
                {approvals?.length
                  ? `${approvals.length} ${approvals.length === 1 ? "utkast" : "utkast"} totalt`
                  : "Ingen outreach skapad ännu"}
              </p>
            </div>

            {!approvals?.length ? (
              <div className="px-5 py-12 text-center">
                <div className="w-10 h-10 rounded-full bg-ink-100 flex items-center justify-center mx-auto mb-3">
                  <Send size={18} strokeWidth={1.5} className="text-ink-300" />
                </div>
                <div className="text-sm text-ink-400 font-medium">Kör Sales Agent för att generera outreach</div>
              </div>
            ) : (
              <div className="divide-y divide-ink-50">
                {approvals.map((a) => {
                  const p = (a.payload as Record<string, unknown>) ?? {};
                  const toEmail   = p["to_email"]  as string | undefined;
                  const subject   = p["subject"]   as string | undefined;
                  const body      = p["body"]       as string | undefined;
                  const bodyHtml  = p["body_html"]  as string | undefined;
                  const metaPitch = p["meta_pitch"] as boolean | undefined;

                  const statusIcon =
                    a.status === "approved"  ? <CheckCircle2 size={14} className="text-emerald-500 shrink-0" strokeWidth={2} />
                    : a.status === "rejected" ? <XCircle size={14} className="text-red-400 shrink-0" strokeWidth={2} />
                    : <Clock size={14} className="text-amber-500 shrink-0" strokeWidth={2} />;

                  const statusLabel =
                    a.status === "approved"  ? "Skickad"
                    : a.status === "rejected" ? "Avvisad"
                    : "Väntar";

                  const bodyText = body ?? (bodyHtml
                    ? bodyHtml.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
                    : null);

                  return (
                    <details key={a.id} className="group">
                      <summary className="flex items-center gap-3 px-5 py-4 cursor-pointer hover:bg-brand-muted/40 transition-colors list-none">
                        {statusIcon}
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm font-semibold text-ink-800 truncate">
                              {subject ?? a.title}
                            </span>
                            {metaPitch && (
                              <span className="badge badge-yellow text-[10px]">Meta-pitch</span>
                            )}
                          </div>
                          <div className="text-xs text-ink-400 mt-0.5">
                            {toEmail && <span className="mr-3">{toEmail}</span>}
                            <span className="font-medium" style={{ color: a.status === "approved" ? "#059669" : a.status === "rejected" ? "#dc2626" : "#d97706" }}>
                              {statusLabel}
                            </span>
                            {" · "}
                            {formatDistanceToNow(new Date(a.created_at as string), { addSuffix: true, locale: sv })}
                          </div>
                        </div>
                        <span className="text-ink-300 text-sm group-open:rotate-180 transition-transform shrink-0">
                          ›
                        </span>
                      </summary>

                      <div className="px-5 pb-5">
                        {a.status === "rejected" && (a.rejection_reason as string | null) && (
                          <div className="mb-3 text-xs text-red-600 bg-red-50 rounded-xl px-3 py-2 border border-red-100">
                            Avvisningsorsak: {a.rejection_reason as string}
                          </div>
                        )}
                        {bodyText && (
                          <div className="bg-ink-50/60 rounded-xl p-4 text-sm text-ink-700 leading-relaxed whitespace-pre-wrap border border-ink-100">
                            {bodyText.slice(0, 1200)}
                            {bodyText.length > 1200 && (
                              <span className="text-ink-400">…</span>
                            )}
                          </div>
                        )}
                        {a.approved_at && (
                          <div className="mt-2 text-xs text-ink-400">
                            {a.status === "approved" ? "Skickad" : "Behandlad"}{" "}
                            {format(new Date(a.approved_at as string), "d MMM HH:mm", { locale: sv })}
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* ── Right: Contact + Stage + Meta ── */}
        <div className="space-y-4">

          {/* Contact */}
          <div className="card p-5">
            <div className="section-label mb-4">Kontakt</div>
            {(lead.contact_name as string | null) ? (
              <div className="font-bold text-ink-900 text-[15px] mb-3">
                {lead.contact_name as string}
              </div>
            ) : (
              <div className="text-sm text-ink-300 mb-3">Ingen kontakt funnen</div>
            )}

            <div className="space-y-2">
              {(lead.contact_email as string | null) && (
                <a
                  href={`mailto:${lead.contact_email}`}
                  className="flex items-center gap-2.5 text-sm text-ink-700 hover:text-brand transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-ink-100 flex items-center justify-center shrink-0">
                    <Mail size={13} className="text-ink-500" strokeWidth={1.75} />
                  </div>
                  <span className="truncate">{lead.contact_email as string}</span>
                </a>
              )}
              {(lead.contact_linkedin as string | null) && (
                <a
                  href={lead.contact_linkedin as string}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 text-sm text-ink-700 hover:text-brand transition-colors"
                >
                  <div className="w-7 h-7 rounded-lg bg-ink-100 flex items-center justify-center shrink-0">
                    <Linkedin size={13} className="text-ink-500" strokeWidth={1.75} />
                  </div>
                  <span>LinkedIn-profil</span>
                  <ExternalLink size={11} className="text-ink-300 ml-auto" />
                </a>
              )}
            </div>
          </div>

          {/* Stage control */}
          <div className="card p-5">
            <div className="section-label mb-4">Stage</div>
            <StageSelector
              leadId={params.id}
              tenantId={tenant.id}
              currentStage={stage}
            />
            <div className="mt-3 text-xs text-ink-400">
              Uppdaterad{" "}
              {formatDistanceToNow(new Date(lead.updated_at as string), { addSuffix: true, locale: sv })}
            </div>
          </div>

          {/* Metadata */}
          {(pains.length > 0 || source) && (
            <div className="card p-5">
              <div className="section-label mb-4">Signaldata</div>

              {source && (
                <div className="mb-3">
                  <div className="text-xs text-ink-400 mb-1">Källa</div>
                  <span className="badge badge-gray">{source.replace(/_/g, " ")}</span>
                </div>
              )}

              {pains.length > 0 && (
                <div>
                  <div className="text-xs text-ink-400 mb-2">Identifierade pains</div>
                  <div className="flex flex-wrap gap-1.5">
                    {pains.map((pain) => (
                      <span key={pain} className="badge badge-yellow text-[10px]">
                        {pain}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Timestamps */}
          <div className="card p-5">
            <div className="section-label mb-3">Tidslinje</div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-ink-400">Tillagd</span>
                <span className="text-ink-700 font-medium tabular-nums">
                  {format(new Date(lead.created_at as string), "d MMM yyyy", { locale: sv })}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-ink-400">Senast ändrad</span>
                <span className="text-ink-700 font-medium tabular-nums">
                  {format(new Date(lead.updated_at as string), "d MMM HH:mm", { locale: sv })}
                </span>
              </div>
              {approvals && approvals.length > 0 && (
                <div className="flex justify-between">
                  <span className="text-ink-400">Utskick</span>
                  <span className="text-ink-700 font-medium tabular-nums">
                    {approvals.filter((a) => a.status === "approved").length} skickade
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
