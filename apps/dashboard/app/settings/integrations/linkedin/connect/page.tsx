import { getActiveTenant } from "@/lib/tenant";
import LinkedInConnectForm from "./LinkedInConnectForm";

export const dynamic = "force-dynamic";

export default async function LinkedInConnectPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Anslut LinkedIn</h1>
        <p className="text-ink-500 text-sm">
          Publicera inlägg och uppdateringar direkt från Agent Hub via LinkedIn API.
        </p>
      </header>

      <section className="card p-5 space-y-3 bg-ink-50/40">
        <h2 className="font-semibold text-sm">Setup (engångs):</h2>
        <ol className="list-decimal list-inside space-y-2 text-sm text-ink-700">
          <li>
            Gå till{" "}
            <a
              href="https://www.linkedin.com/developers"
              target="_blank"
              rel="noopener noreferrer"
              className="text-brand underline"
            >
              linkedin.com/developers
            </a>{" "}
            och skapa en app (eller välj en befintlig).
          </li>
          <li>
            Under fliken <strong>Auth</strong> → <strong>OAuth 2.0 tools</strong> → generera en
            token med scoperna <code className="text-xs bg-ink-100 px-1 rounded">w_member_social</code>{" "}
            och <code className="text-xs bg-ink-100 px-1 rounded">r_liteprofile</code>.
          </li>
          <li>Token är giltig i 60 dagar — förnya innan den löper ut.</li>
          <li>
            Hitta ditt Author URN via:{" "}
            <code className="text-xs bg-ink-100 px-1 rounded block mt-1 p-2">
              curl -H &quot;Authorization: Bearer TOKEN&quot; https://api.linkedin.com/v2/me
            </code>
            Kopiera <code className="text-xs bg-ink-100 px-1 rounded">id</code>-fältet och bygg{" "}
            <code className="text-xs bg-ink-100 px-1 rounded">urn:li:person:&#123;id&#125;</code>.
          </li>
        </ol>
      </section>

      <LinkedInConnectForm tenantId={tenant.id} />
    </div>
  );
}
