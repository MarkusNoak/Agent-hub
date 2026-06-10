"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
import { sv } from "date-fns/locale";
import { Pencil, X, Send, ThumbsDown, Save } from "lucide-react";
import { approveAction, rejectAction, saveDraftEdits } from "./actions";

type Approval = {
  id: string;
  agent_kind: string;
  action: string;
  title: string;
  summary: string | null;
  payload: Record<string, unknown> | null;
  created_at: string;
  status: string;
};

type GmailAccount = { id: string; label: string; from: string };

const EMAIL_ACTIONS = new Set(["send_email", "send_invoice_reminder"]);

function htmlToPlain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function ApprovalCard({
  approval,
  tenantId,
  gmailAccounts = [],
}: {
  approval: Approval;
  tenantId: string;
  gmailAccounts?: GmailAccount[];
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const [showReject, setShowReject] = useState(false);

  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  const isEmail = EMAIL_ACTIONS.has(approval.action);

  const rawTo = String(payload["to_email"] ?? payload["customer_email"] ?? "");
  const rawSubject = String(payload["subject"] ?? "");
  const rawBodyText = htmlToPlain(String(payload["body_html"] ?? payload["body"] ?? ""));

  const needsVerify =
    rawSubject.toUpperCase().includes("[VERIFIERA ADRESS]") ||
    rawTo.toUpperCase().includes("[VERIFIERA ADRESS]");

  const [to, setTo] = useState(rawTo.replace(/^\[VERIFIERA ADRESS\]\s*/i, "").trim());
  const [subject, setSubject] = useState(rawSubject.replace(/^\[VERIFIERA ADRESS\]\s*/i, "").trim());
  const [body, setBody] = useState(rawBodyText);
  const [fromAccountId, setFromAccountId] = useState(gmailAccounts[0]?.id ?? "");

  const fromLabel =
    gmailAccounts.find((a) => a.id === fromAccountId)?.from ||
    gmailAccounts[0]?.from ||
    gmailAccounts[0]?.label ||
    "";

  function buildFormData() {
    const fd = new FormData();
    fd.set("id", approval.id);
    fd.set("tenantId", tenantId);
    fd.set("edit_to_email", to);
    fd.set("edit_subject", subject);
    fd.set("edit_body", body);
    fd.set("reason", reason);
    if (fromAccountId) fd.set("from_integration_id", fromAccountId);
    return fd;
  }

  function run(
    action: (fd: FormData) => Promise<{ ok: true } | { ok: false; error: string }>,
    endCard: boolean,
  ) {
    setError(null);
    const fd = buildFormData();
    startTransition(async () => {
      const result = await action(fd);
      if (!result.ok) {
        setError(result.error);
      } else if (endCard) {
        setDone(true);
      }
    });
  }

  if (done) {
    return (
      <div className="card p-5 text-sm text-green-700 bg-green-50 border border-green-200">
        Åtgärd utförd: <strong>{approval.title}</strong>
      </div>
    );
  }

  return (
    <div className="card overflow-hidden">
      {/* Card header */}
      <div className="px-5 pt-5 pb-4 border-b border-ink-100">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-2">
              <span className="badge badge-blue">{approval.agent_kind}</span>
              <span className="badge badge-gray">{approval.action}</span>
              {needsVerify && (
                <span className="badge badge-yellow" title="Kontrollera fältet Till — adressen kan behöva korrigeras.">
                  ⚠ Verifiera adress
                </span>
              )}
              <span className="text-[11px] text-ink-400 ml-auto" suppressHydrationWarning>
                {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true, locale: sv })}
              </span>
            </div>
            <h3 className="font-semibold text-ink-900 text-[15px] leading-snug">{approval.title}</h3>
            {approval.summary && (
              <p className="text-sm text-ink-500 mt-0.5">{approval.summary}</p>
            )}
          </div>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="mx-5 mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Email preview / edit */}
      {isEmail ? (
        <div className="px-5 py-4">
          {editing ? (
            /* ── Edit mode ── */
            <div className="space-y-3">
              {gmailAccounts.length > 1 && (
                <div className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
                  <span className="text-xs font-semibold text-ink-500 text-right">Från</span>
                  <select
                    value={fromAccountId}
                    onChange={(e) => setFromAccountId(e.target.value)}
                    className="input"
                  >
                    {gmailAccounts.map((acc) => (
                      <option key={acc.id} value={acc.id}>
                        {acc.from || acc.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              <div className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
                <span className="text-xs font-semibold text-ink-500 text-right">Till</span>
                <input
                  type="email"
                  value={to}
                  onChange={(e) => setTo(e.target.value)}
                  className={`input ${needsVerify ? "border-yellow-400 bg-yellow-50" : ""}`}
                />
              </div>
              <div className="grid grid-cols-[3.5rem_1fr] items-center gap-3">
                <span className="text-xs font-semibold text-ink-500 text-right">Ämne</span>
                <input
                  type="text"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  className="input"
                />
              </div>
              <div className="grid grid-cols-[3.5rem_1fr] items-start gap-3">
                <span className="text-xs font-semibold text-ink-500 text-right pt-2.5">Text</span>
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={14}
                  className="input resize-y font-sans leading-relaxed"
                />
              </div>
            </div>
          ) : (
            /* ── Preview mode ── */
            <div
              className="rounded-2xl border border-ink-100 overflow-hidden"
              style={{ background: "linear-gradient(180deg, #fafaf9 0%, #ffffff 100%)" }}
            >
              {/* Email header */}
              <div className="px-5 py-3 border-b border-ink-100 space-y-1.5">
                {fromLabel && (
                  <div className="flex items-baseline gap-2 text-sm">
                    <span className="text-xs font-semibold text-ink-400 w-10 shrink-0 text-right">Från</span>
                    <span className="text-ink-700 truncate">{fromLabel}</span>
                  </div>
                )}
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-xs font-semibold text-ink-400 w-10 shrink-0 text-right">Till</span>
                  <span className={`truncate font-medium ${needsVerify ? "text-amber-700" : "text-ink-800"}`}>
                    {to || <span className="text-ink-300 italic">saknas</span>}
                  </span>
                </div>
                <div className="flex items-baseline gap-2 text-sm">
                  <span className="text-xs font-semibold text-ink-400 w-10 shrink-0 text-right">Ämne</span>
                  <span className="font-semibold text-ink-900 leading-snug">
                    {subject || <span className="text-ink-300 italic font-normal">saknas</span>}
                  </span>
                </div>
              </div>

              {/* Email body */}
              <div className="px-5 py-4">
                <p className="text-sm text-ink-700 leading-relaxed whitespace-pre-wrap">
                  {body || <span className="text-ink-300 italic">Inget innehåll</span>}
                </p>
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ── Non-email payload ── */
        <div className="px-5 py-4">
          <pre className="p-4 bg-ink-50 rounded-2xl text-xs overflow-x-auto whitespace-pre-wrap max-h-64 text-ink-700">
            {JSON.stringify(payload, null, 2)}
          </pre>
        </div>
      )}

      {/* Reject reason input */}
      {showReject && (
        <div className="px-5 pb-3">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Anledning till avvisning (valfritt)…"
            className="input"
            autoFocus
          />
        </div>
      )}

      {/* Action bar */}
      <div className="px-5 pb-5 flex flex-wrap items-center gap-2 pt-3 border-t border-ink-100">
        <button
          type="button"
          disabled={isPending}
          onClick={() => run(approveAction, true)}
          className="btn btn-primary gap-1.5"
        >
          <Send size={13} />
          {isEmail ? "Godkänn & skicka" : "Godkänn & kör"}
        </button>

        {isEmail && (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                if (editing) {
                  run(saveDraftEdits, false);
                  setEditing(false);
                } else {
                  setEditing(true);
                }
              }}
              className="btn btn-outline gap-1.5"
            >
              {editing ? (
                <>
                  <Save size={13} />
                  Spara utkast
                </>
              ) : (
                <>
                  <Pencil size={13} />
                  Redigera
                </>
              )}
            </button>

            {editing && (
              <button
                type="button"
                onClick={() => setEditing(false)}
                className="btn btn-ghost gap-1.5 text-ink-500"
              >
                <X size={13} />
                Avbryt
              </button>
            )}
          </>
        )}

        {showReject ? (
          <>
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(rejectAction, true)}
              className="btn btn-danger gap-1.5 ml-auto"
            >
              <ThumbsDown size={13} />
              Bekräfta avvisning
            </button>
            <button
              type="button"
              onClick={() => { setShowReject(false); setReason(""); }}
              className="btn btn-ghost text-ink-500"
            >
              <X size={13} />
            </button>
          </>
        ) : (
          <button
            type="button"
            disabled={isPending}
            onClick={() => setShowReject(true)}
            className="btn btn-outline gap-1.5 ml-auto text-ink-600"
          >
            <ThumbsDown size={13} />
            Avvisa
          </button>
        )}
      </div>
    </div>
  );
}
