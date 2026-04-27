import { getActiveTenant } from "@/lib/tenant";
import SlackConnectForm from "./SlackConnectForm";

export const dynamic = "force-dynamic";

export default async function SlackConnectPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Koppla Slack</h1>
        <p className="text-ink-500 text-sm">
          Skickar notiser till er Slack-grupp när agenten skapar nya approvals.
        </p>
      </header>

      <section className="card p-5 space-y-3 bg-ink-50/40">
        <h2 className="font-semibold text-sm">Setup (2 minuter):</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-ink-700">
          <li>Gå till <strong>api.slack.com/apps</strong> → skapa en ny app eller välj befintlig.</li>
          <li>Under <strong>Features → Incoming Webhooks</strong> → aktivera och klicka <strong>Add New Webhook to Workspace</strong>.</li>
          <li>Välj kanalen eller gruppen (t.ex. din och Lucas direktgrupp).</li>
          <li>Kopiera webhook-URL:en och klistra in nedan.</li>
        </ol>
      </section>

      <SlackConnectForm tenantId={tenant.id} />
    </div>
  );
}
