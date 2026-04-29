import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

const WKIT_DOMAINS = ["weknowit.se", "weknowit.nu"];
const WKIT_TENANT_SLUG = "we-know-it";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    return NextResponse.redirect(new URL("/", url.origin));
  }

  const supa = createSupabaseServerClient();
  const { data: { session } } = await supa.auth.exchangeCodeForSession(code);

  if (!session?.user) {
    return NextResponse.redirect(new URL("/", url.origin));
  }

  const admin = createSupabaseAdminClient();
  const userId = session.user.id;
  const email = session.user.email ?? "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  // Check if user already belongs to a tenant — if so, nothing to provision.
  const { data: existing } = await admin
    .from("users_tenants")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1);

  if (!existing?.length && domain) {
    if (WKIT_DOMAINS.includes(domain)) {
      // WKIT team member — add to the main weknowit tenant as admin.
      const { data: wkitTenant } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", WKIT_TENANT_SLUG)
        .single();

      if (wkitTenant) {
        await admin.from("users_tenants").upsert(
          { user_id: userId, tenant_id: wkitTenant.id, role: "admin" },
          { onConflict: "user_id,tenant_id" },
        );
      }
    } else {
      // External customer — find or create a tenant for their email domain.
      const slug = domain.replace(/\./g, "-");
      const { data: existing_tenant } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (existing_tenant) {
        // Another user from the same company already created the tenant.
        await admin.from("users_tenants").upsert(
          { user_id: userId, tenant_id: existing_tenant.id, role: "admin" },
          { onConflict: "user_id,tenant_id" },
        );
      } else {
        // First user from this company — create the tenant and make them owner.
        const name = (domain.split(".")[0] ?? domain)
          .charAt(0).toUpperCase() + (domain.split(".")[0] ?? domain).slice(1);

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

  return NextResponse.redirect(new URL("/", url.origin));
}
