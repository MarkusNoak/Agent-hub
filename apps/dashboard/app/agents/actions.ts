"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function toggleAgent(formData: FormData) {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));
  const newStatus = String(formData.get("newStatus"));

  const supa = createSupabaseServerClient();
  await supa
    .from("agents")
    .update({ status: newStatus })
    .eq("id", id)
    .eq("tenant_id", tenantId);

  revalidatePath("/agents");
}
