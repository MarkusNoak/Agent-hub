import { getActiveTenant } from "@/lib/tenant";
import { saveGmailSmtp } from "./actions";

export const dynamic = "force-dynamic";

export default async function GmailConnectPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Connect Gmail</h1>
        <p className="text-ink-500 text-sm">
          Skickar outreach, fakturapåminnelser och andra mejl från ditt Gmail-konto.
          Vi använder SMTP + App Password — ingen OAuth eller Google Cloud-setup krävs.
        </p>
      </header>

      <section className="card p-5 space-y-3 bg-ink-50/40">
        <h2 className="font-semibold text-sm">Setup (5 minuter, engångs):</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-ink-700">
          <li>
            Aktivera 2FA på det Gmail-konto du vill skicka från:{" "}
            <a
              href="https://myaccount.google.com/signinoptions/two-step-verification"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              myaccount.google.com/signinoptions/two-step-verification
            </a>
          </li>
          <li>
            Generera ett App Password:{" "}
            <a
              href="https://myaccount.google.com/apppasswords"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              myaccount.google.com/apppasswords
            </a>{" "}
            — välj "Other (Custom name)" → "Agent Hub".
          </li>
          <li>Kopiera 16-teckens-lösenordet och klistra in nedan.</li>
        </ol>
      </section>

      <form action={saveGmailSmtp} className="card p-5 space-y-4">
        <input type="hidden" name="tenantId" value={tenant.id} />

        <label className="block space-y-1">
          <span className="text-sm font-medium">Avsändaradress</span>
          <input
            type="email"
            name="from"
            required
            placeholder="sales@weknowit.se"
            className="w-full border border-ink-200 rounded-lg p-2 text-sm"
          />
          <span className="text-xs text-ink-500">
            Den adress som mottagare ser. Måste vara ett Gmail- eller Google Workspace-konto.
          </span>
        </label>

        <label className="block space-y-1">
          <span className="text-sm font-medium">App Password</span>
          <input
            type="password"
            name="password"
            required
            placeholder="xxxx xxxx xxxx xxxx"
            autoComplete="off"
            className="w-full border border-ink-200 rounded-lg p-2 text-sm font-mono"
          />
          <span className="text-xs text-ink-500">
            16 tecken. Sparas krypterat i databasen. Inget annat sätt kommer åt ditt Gmail.
          </span>
        </label>

        <div className="flex gap-2 pt-2">
          <button type="submit" className="btn btn-primary">
            Test &amp; save
          </button>
          <a href="/settings" className="btn btn-secondary">
            Cancel
          </a>
        </div>
      </form>

      <p className="text-xs text-ink-500">
        Vid "Test &amp; save" försöker vi logga in med SMTP mot smtp.gmail.com:587 och bekräfta
        att credentials funkar. Du får error om något är fel — inget sparas då.
      </p>
    </div>
  );
}