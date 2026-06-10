import { getActiveTenant } from "@/lib/tenant";
import ChatUI from "./ChatUI";

export const dynamic = "force-dynamic";

export default async function ChatPage() {
  const tenant = await getActiveTenant();
  if (!tenant) return null;

  return (
    <ChatUI
      userId={tenant.user.id}
      tenantId={tenant.id}
    />
  );
}
