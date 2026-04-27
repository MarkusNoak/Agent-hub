"use client";

import { useState, useTransition } from "react";
import { formatDistanceToNow } from "date-fns";
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
}: {
  approval: Approval;
  tenantId: string;
}) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  const isEmail = EMAIL_ACTIONS.has(approval.action);

  const rawTo = String(payload["to_email"] ?? payload["customer_email"] ?? "");
  const rawSubject = String(payload["subject"] ?? "");
  const rawBodyHtml = String(payload["body_html"] ?? payload["body"] ?? "");

  const needsVerify =
    rawSubject.toUpperCase().includes("[VERIFIERA ADRESS]") ||
    rawTo.toUpperCase().includes("[VERIFIERA ADRESS]");

  const [to, setTo] = useState(rawTo.replace(/^\[VERIFIERA ADRESS\]\s*/i, ""));
  const [subject, setSubject] = useState(rawSubject.replace(/^\[VERIFIERA ADRESS\]\s*/i, ""));
  const [body, setBody] = useState(htmlToPlain(rawBodyHtml));
  const [reason, setReason] = useState("");

  function buildFormData() {
    const fd = new FormData();
    fd.set("id", approval.id);
    fd.set("tenantId", tenantId);
    fd.set("edit_to_email", to);
    fd.set("edit_subject", subject);
    fd.set("edit_body", body);
    fd.set("reason", reason);
    return fd;
  }

  function run(action: (fd: FormData) => Promise<void>, endCard: boolean) {
    setError(null);
    const fd = buildFormData();
    startTransition(async () => {
      try {
        await action(fd);
        if (endCard) setDone(true);
      } catch (e) {
        setError((e as Error).message);
      }
    });
  }

  if (done) {
    return (
      <div className="card p-5 text-sm text-green-700 bg-green-50 border border-green-200">
        Åtgärd utförd för: <strong>{approval.title}</strong>
      </div>
    );
  }

  return (
    <div className="card p-6 space-y-4">
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-blue">{approval.agent_kind}</span>
          <span className="badge badge-gray">{approval.action}</span>
          {needsVerify && (
            <span className="badge badge-yellow" title="Kontrollera fältet 'Till' — adressen kan behöva korrigeras.">
              ⚠ Verifiera adress
            </span>
          )}
        </div>
        <span className="text-xs text-ink-500 shrink-0 ml-2">
          {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true })}
        </span>
      </div>

      <div>
        <h3 className="font-semibold text-ink-900">{approval.title}</h3>
        {approval.summary && <p className="text-sm text-ink-500 mt-0.5">{approval.summary}</p>}
      </div>

      {error && (
        <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {isEmail ? (
          <>
            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
              <label className="text-xs font-semibold text-ink-500 text-right">Till</label>
              <input
                type="email"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className={`input ${needsVerify ? "border-yellow-400 bg-yellow-50 focus:border-yellow-500" : ""}`}
              />
            </div>

            <div className="grid grid-cols-[4.5rem_1fr] items-center gap-3">
              <label className="text-xs font-semibold text-ink-500 text-right">Ämne</label>
              <input
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                className="input"
              />
            </div>

            <div className="grid grid-cols-[4.5rem_1fr] items-start gap-3">
              <label className="text-xs font-semibold text-ink-500 text-right pt-2.5">Meddelande</label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={12}
                className="input resize-y font-sans leading-relaxed"
              />
            </div>
          </>
        ) : (
          <pre className="p-4 bg-ink-50 rounded-2xl text-xs overflow-x-auto whitespace-pre-wrap max-h-64 text-ink-700">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}

        <div className="flex flex-wrap gap-2 items-center pt-2 border-t border-ink-100">
          <button
            type="button"
            disabled={isPending}
            onClick={() => run(approveAction, true)}
            className="btn btn-primary"
          >
            {isPending ? "…" : isEmail ? "Godkänn & skicka" : "Godkänn & kör"}
          </button>

          {isEmail && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => run(saveDraftEdits, false)}
              className="btn btn-outline"
            >
              {isPending ? "…" : "Spara utkast"}
            </button>
          )}

          <button
            type="button"
            disabled={isPending}
            onClick={() => run(rejectAction, true)}
            className="btn btn-outline"
          >
            Avvisa
          </button>

          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Anledning vid avvisning…"
            className="input flex-1 min-w-[8rem]"
          />
        </div>
      </div>
    </div>
  );
}
