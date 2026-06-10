"use server";
import { revalidatePath } from "next/cache";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export async function disconnectIntegration(formData: FormData): Promise<void> {
  const id = String(formData.get("id"));
  const tenantId = String(formData.get("tenantId"));

  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) throw new Error("Inte inloggad.");

  const { data: membership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenantId)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!membership || !["owner", "admin"].includes(membership.role as string)) {
    throw new Error("Forbidden.");
  }

  const admin = createSupabaseAdminClient();
  await admin.from("integrations").delete().eq("id", id).eq("tenant_id", tenantId);
  revalidatePath("/settings");
}
