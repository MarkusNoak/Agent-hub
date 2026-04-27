"use client";

import { useRef, useState, useTransition } from "react";
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

/** Strip HTML tags so the textarea shows plain text, not markup. */
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
  const formRef = useRef<HTMLFormElement>(null);
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

  // Controlled state — preserves edits across any server re-renders
  const [toVal, setToVal] = useState(
    rawTo.replace(/^\[VERIFIERA ADRESS\]\s*/i, ""),
  );
  const [subjectVal, setSubjectVal] = useState(
    rawSubject.replace(/^\[VERIFIERA ADRESS\]\s*/i, ""),
  );
  const [bodyVal, setBodyVal] = useState(htmlToPlain(rawBodyHtml));

  function runAction(action: (fd: FormData) => Promise<void>, onSuccess: "done" | "none") {
    setError(null);
    // Build FormData manually from controlled state + hidden fields
    const fd = new FormData(formRef.current!);
    fd.set("edit_to_email", toVal);
    fd.set("edit_subject", subjectVal);
    fd.set("edit_body", bodyVal);
    startTransition(async () => {
      try {
        await action(fd);
        if (onSuccess === "done") setDone(true);
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
    <div className="card p-5 space-y-3">
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-blue">{approval.agent_kind}</span>
          <span className="badge badge-gray">{approval.action}</span>
          {needsVerify && (
            <span
              className="badge badge-yellow"
              title="Agenten kunde inte hitta en verifierad adress — korrigera fältet 'Till'."
            >
              ⚠ Verifiera adress
            </span>
          )}
        </div>
        <span className="text-xs text-ink-500 shrink-0 ml-2">
          {formatDistanceToNow(new Date(approval.created_at), { addSuffix: true })}
        </span>
      </div>

      <h3 className="font-semibold">{approval.title}</h3>
      {approval.summary && (
        <p className="text-sm text-ink-500">{approval.summary}</p>
      )}

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* Hidden fields only — the three editable fields are controlled above */}
      <form ref={formRef} className="space-y-3">
        <input type="hidden" name="id" value={approval.id} />
        <input type="hidden" name="tenantId" value={tenantId} />

        {isEmail ? (
          <>
            <div className="grid grid-cols-[4rem_1fr] items-center gap-2">
              <label className="text-xs font-medium text-ink-500 text-right">Till</label>
              <input
                type="email"
                value={toVal}
                onChange={(e) => setToVal(e.target.value)}
                required
                className={`border rounded-lg p-2 text-sm w-full ${
                  needsVerify
                    ? "border-yellow-400 bg-yellow-50 focus:border-yellow-500"
                    : "border-ink-200"
                }`}
              />
            </div>

            <div className="grid grid-cols-[4rem_1fr] items-center gap-2">
              <label className="text-xs font-medium text-ink-500 text-right">Ämne</label>
              <input
                type="text"
                value={subjectVal}
                onChange={(e) => setSubjectVal(e.target.value)}
                required
                className="border border-ink-200 rounded-lg p-2 text-sm w-full"
              />
            </div>

            <div className="grid grid-cols-[4rem_1fr] items-start gap-2">
              <label className="text-xs font-medium text-ink-500 text-right pt-2">
                Meddelande
              </label>
              <textarea
                value={bodyVal}
                onChange={(e) => setBodyVal(e.target.value)}
                rows={12}
                required
                className="border border-ink-200 rounded-lg p-2 text-sm w-full resize-y font-sans leading-relaxed"
              />
            </div>
          </>
        ) : (
          <pre className="p-3 bg-ink-50 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-64">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}

        <div className="flex flex-wrap gap-2 items-center pt-1">
          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction(approveAction, "done")}
            className="btn btn-primary"
          >
            {isPending ? "Skickar…" : isEmail ? "Godkänn & skicka" : "Godkänn & kör"}
          </button>

          {isEmail && (
            <button
              type="button"
              disabled={isPending}
              onClick={() => runAction(saveDraftEdits, "none")}
              className="btn btn-secondary"
              title="Spara redigeringar utan att skicka"
            >
              {isPending ? "Sparar…" : "Spara utkast"}
            </button>
          )}

          <button
            type="button"
            disabled={isPending}
            onClick={() => runAction(rejectAction, "done")}
            className="btn btn-secondary"
          >
            Avvisa
          </button>

          <input
            name="reason"
            placeholder="Anledning vid avvisning"
            className="flex-1 min-w-[8rem] px-3 py-1.5 border border-ink-200 rounded-lg text-sm"
          />
        </div>
      </form>
    </div>
  );
}
