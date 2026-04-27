import { getActiveTenant } from "@/lib/tenant";
import ClockifyConnectForm from "./ClockifyConnectForm";

export const dynamic = "force-dynamic";

export default async function ClockifyConnectPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Koppla Clockify</h1>
        <p className="text-ink-500 text-sm">
          Synkar tidrapportering för automatisk budgetkontroll och fakturerings-underlag.
        </p>
      </header>
      <ClockifyConnectForm tenantId={tenant.id} />
    </div>
  );
}
