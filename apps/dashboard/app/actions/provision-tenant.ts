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
  } else {
    const slug = domain.replace(/\./g, "-");
    const name =
      (domain.split(".")[0] ?? domain).charAt(0).toUpperCase() +
      (domain.split(".")[0] ?? domain).slice(1);

    const { data: existingTenant } = await admin
      .from("tenants")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();

    if (existingTenant) {
      await admin.from("users_tenants").upsert(
        { user_id: userId, tenant_id: existingTenant.id, role: "admin" },
        { onConflict: "user_id,tenant_id" },
      );
    } else {
      const { data: newTenant } = await admin
        .from("tenants")
        .insert({ slug, name, plan: "starter", settings: {} })
        .select("id")
        .single();

      if (newTenant) {
        await admin.from("users_tenants").insert({
          user_id: userId,
          tenant_id: newTenant.id,
          role: "owner",
        });
      }
    }
  }
}
