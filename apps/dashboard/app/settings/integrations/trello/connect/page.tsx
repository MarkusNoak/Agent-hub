import { getActiveTenant } from "@/lib/tenant";
import TrelloConnectForm from "./TrelloConnectForm";

export const dynamic = "force-dynamic";

export default async function TrelloConnectPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <div className="max-w-xl space-y-6">
      <header>
        <h1 className="text-2xl font-semibold">Koppla Trello</h1>
        <p className="text-ink-500 text-sm">
          Agenter kan skapa och flytta kort på dina Trello-boards.
        </p>
      </header>
      <TrelloConnectForm tenantId={tenant.id} />
    </div>
  );
}
