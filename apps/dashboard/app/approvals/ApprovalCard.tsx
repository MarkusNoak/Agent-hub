"use client";

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

export function ApprovalCard({
  approval,
  tenantId,
}: {
  approval: Approval;
  tenantId: string;
}) {
  const payload = (approval.payload ?? {}) as Record<string, unknown>;
  const isEmail = EMAIL_ACTIONS.has(approval.action);

  const rawTo = String(payload["to_email"] ?? payload["customer_email"] ?? "");
  const rawSubject = String(payload["subject"] ?? "");
  const rawBody = String(payload["body"] ?? payload["body_html"] ?? "");

  // Strip [VERIFIERA ADRESS] prefix — user sees it as a warning badge instead
  const defaultTo = rawTo.replace(/^\[VERIFIERA ADRESS\]\s*/i, "");
  const defaultSubject = rawSubject.replace(/^\[VERIFIERA ADRESS\]\s*/i, "");
  const needsAddressVerification =
    rawSubject.toUpperCase().includes("[VERIFIERA ADRESS]") ||
    rawTo.toUpperCase().includes("[VERIFIERA ADRESS]");

  return (
    <div className="card p-5 space-y-3">
      {/* Header row */}
      <div className="flex items-start justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge badge-blue">{approval.agent_kind}</span>
          <span className="badge badge-gray">{approval.action}</span>
          {needsAddressVerification && (
            <span className="badge badge-yellow" title="Agenten kunde inte hitta en verifierad e-postadress — kontrollera fältet 'Till' nedan.">
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

      <form className="space-y-3">
        <input type="hidden" name="id" value={approval.id} />
        <input type="hidden" name="tenantId" value={tenantId} />

        {isEmail ? (
          <>
            <div className="grid grid-cols-[4rem_1fr] items-center gap-2">
              <label className="text-xs font-medium text-ink-500 text-right">Till</label>
              <input
                type="email"
                name="edit_to_email"
                defaultValue={defaultTo}
                required
                className={`border rounded-lg p-2 text-sm w-full ${
                  needsAddressVerification
                    ? "border-yellow-400 bg-yellow-50 focus:border-yellow-500"
                    : "border-ink-200"
                }`}
              />
            </div>

            <div className="grid grid-cols-[4rem_1fr] items-center gap-2">
              <label className="text-xs font-medium text-ink-500 text-right">Ämne</label>
              <input
                type="text"
                name="edit_subject"
                defaultValue={defaultSubject}
                required
                className="border border-ink-200 rounded-lg p-2 text-sm w-full"
              />
            </div>

            <div className="grid grid-cols-[4rem_1fr] items-start gap-2">
              <label className="text-xs font-medium text-ink-500 text-right pt-2">Meddelande</label>
              <textarea
                name="edit_body"
                rows={9}
                defaultValue={rawBody}
                required
                className="border border-ink-200 rounded-lg p-2 text-sm w-full resize-y font-sans leading-relaxed"
              />
            </div>
          </>
        ) : (
          /* Non-email actions: show raw payload, no editing needed */
          <pre className="p-3 bg-ink-50 rounded-lg text-xs overflow-x-auto whitespace-pre-wrap max-h-64">
            {JSON.stringify(payload, null, 2)}
          </pre>
        )}

        <div className="flex flex-wrap gap-2 items-center pt-1">
          <button formAction={approveAction} className="btn btn-primary">
            {isEmail ? "Godkänn & skicka" : "Godkänn & kör"}
          </button>
          {isEmail && (
            <button
              formAction={saveDraftEdits}
              className="btn btn-secondary"
              title="Spara redigeringar utan att skicka"
            >
              Spara utkast
            </button>
          )}
          <button formAction={rejectAction} className="btn btn-secondary">
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
