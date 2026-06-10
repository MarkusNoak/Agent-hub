import { getActiveTenant } from "@/lib/tenant";
import GmailConnectForm from "./GmailConnectForm";

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
            Aktivera 2FA på det Gmail- eller Google Workspace-konto du vill skicka från:{" "}
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
        <p className="text-xs text-ink-500 mt-2">
          Fungerar med alla Gmail-adresser och Google Workspace-domäner (.se, .nu, .com etc.).
        </p>
      </section>

      <GmailConnectForm tenantId={tenant.id} />

      <p className="text-xs text-ink-500">
        Vid "Test &amp; save" försöker vi logga in med SMTP mot smtp.gmail.com:587 och bekräfta
        att credentials funkar. Inget sparas om testet misslyckas.
      </p>
    </div>
  );
}
