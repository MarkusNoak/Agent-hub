import { getActiveTenant } from "@/lib/tenant";
import GithubConnectForm from "./GithubConnectForm";

export const dynamic = "force-dynamic";

export default async function GithubConnectPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Koppla GitHub</h1>
        <p className="text-ink-500 text-sm">
          Agenter kan söka issues, läsa dokumentation och förstå kodbaser.
        </p>
      </header>
      <GithubConnectForm tenantId={tenant.id} />
    </div>
  );
}
