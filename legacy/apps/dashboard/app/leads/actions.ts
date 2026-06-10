"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

const VALID_STAGES = [
  "new",
  "researched",
  "outreach_drafted",
  "outreach_sent",
  "replied",
  "qualified",
  "won",
  "lost",
] as const;

export async function updateLeadStage(formData: FormData) {
  const leadId = String(formData.get("leadId"));
  const tenantId = String(formData.get("tenantId"));
  const stage = String(formData.get("stage"));

  if (!VALID_STAGES.includes(stage as (typeof VALID_STAGES)[number])) {
    throw new Error(`Invalid stage: ${stage}`);
  }

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Unauthenticated.");

  await supa
    .from("leads")
    .update({ stage, updated_at: new Date().toISOString() })
    .eq("id", leadId)
    .eq("tenant_id", tenantId);

  revalidatePath("/leads");
}
