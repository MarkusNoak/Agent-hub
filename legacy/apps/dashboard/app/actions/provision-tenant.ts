"use server";

import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

const WKIT_DOMAINS = ["weknowit.se", "weknowit.nu"];
const WKIT_TENANT_SLUG = "we-know-it";

export async function provisionTenant(): Promise<void> {
  const supa = createSupabaseServerClient();
  const { data: { user } } = await supa.auth.getUser();
  if (!user) return;

  const admin = createSupabaseAdminClient();
  const userId = user.id;
  const email = user.email ?? "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  const { data: existing } = await admin
    .from("users_tenants")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1);

  if (existing?.length) return;

  if (!domain) return;

  if (WKIT_DOMAINS.includes(domain)) {
    let tenantId: string | null = null;

    const { data: wkitTenant } = await admin
      .from("tenants")
      .select("id")
      .eq("slug", WKIT_TENANT_SLUG)
      .maybeSingle();

    if (wkitTenant) {
      tenantId = wkitTenant.id as string;
    } else {
      const { data: created } = await admin
        .from("tenants")
        .insert({ slug: WKIT_TENANT_SLUG, name: "We Know IT", plan: "starter", settings: {} })
        .select("id")
        .single();
      tenantId = created?.id ?? null;
    }

    if (tenantId) {
      await admin.from("users_tenants").upsert(
        { user_id: userId, tenant_id: tenantId, role: "owner" },
        { onConflict: "user_id,tenant_id" },
      );
    }
  }
  // Unknown domain — no tenant provisioned. User will land on /no-access.
}
