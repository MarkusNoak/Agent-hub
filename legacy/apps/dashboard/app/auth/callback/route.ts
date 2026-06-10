import { NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

const WKIT_DOMAINS = ["weknowit.se", "weknowit.nu"];
const WKIT_TENANT_SLUG = "we-know-it";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");

  if (!code) {
    console.log("[auth/callback] No code in URL — redirecting to /");
    return NextResponse.redirect(new URL("/", url.origin));
  }

  const supa = createSupabaseServerClient();
  const { data: { session }, error: sessionError } = await supa.auth.exchangeCodeForSession(code);

  if (sessionError) {
    console.error("[auth/callback] exchangeCodeForSession error:", sessionError.message);
  }

  if (!session?.user) {
    console.log("[auth/callback] No session after exchange — redirecting to /");
    return NextResponse.redirect(new URL("/", url.origin));
  }

  console.log("[auth/callback] Session OK for:", session.user.email);

  const admin = createSupabaseAdminClient();
  const userId = session.user.id;
  const email = session.user.email ?? "";
  const domain = email.split("@")[1]?.toLowerCase() ?? "";

  // Check if user already belongs to a tenant.
  const { data: existing, error: existingError } = await admin
    .from("users_tenants")
    .select("tenant_id")
    .eq("user_id", userId)
    .limit(1);

  if (existingError) {
    console.error("[auth/callback] users_tenants lookup error:", existingError.message, existingError.code);
  }

  console.log("[auth/callback] Existing memberships:", existing?.length ?? 0);

  if (!existing?.length && domain) {
    if (WKIT_DOMAINS.includes(domain)) {
      let wkitTenantId: string | null = null;
      const { data: wkitTenant, error: tenantErr } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", WKIT_TENANT_SLUG)
        .maybeSingle();

      if (tenantErr) console.error("[auth/callback] tenants lookup error:", tenantErr.message);

      if (wkitTenant) {
        wkitTenantId = wkitTenant.id as string;
        console.log("[auth/callback] Found WKIT tenant:", wkitTenantId);
      } else {
        console.log("[auth/callback] WKIT tenant missing — creating it");
        const { data: created, error: createErr } = await admin
          .from("tenants")
          .insert({ slug: WKIT_TENANT_SLUG, name: "We Know IT", plan: "starter", settings: {} })
          .select("id")
          .single();
        if (createErr) console.error("[auth/callback] tenant create error:", createErr.message);
        wkitTenantId = created?.id ?? null;
      }

      if (wkitTenantId) {
        const { error: upsertErr } = await admin.from("users_tenants").upsert(
          { user_id: userId, tenant_id: wkitTenantId, role: "owner" },
          { onConflict: "user_id,tenant_id" },
        );
        if (upsertErr) console.error("[auth/callback] users_tenants upsert error:", upsertErr.message);
        else console.log("[auth/callback] User linked to WKIT tenant OK");
      }
    } else {
      const slug = domain.replace(/\./g, "-");
      const { data: existing_tenant } = await admin
        .from("tenants")
        .select("id")
        .eq("slug", slug)
        .maybeSingle();

      if (existing_tenant) {
        await admin.from("users_tenants").upsert(
          { user_id: userId, tenant_id: existing_tenant.id, role: "admin" },
          { onConflict: "user_id,tenant_id" },
        );
      } else {
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
