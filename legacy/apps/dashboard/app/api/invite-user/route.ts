import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient, createSupabaseAdminClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Unauthenticated" }, { status: 401 });

  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const email = String(body.email ?? "").trim().toLowerCase();
  const role = String(body.role ?? "admin");
  const tenantSlug = String(body.tenantSlug ?? "");

  if (!email || !tenantSlug) {
    return NextResponse.json({ error: "Missing email or tenantSlug." }, { status: 400 });
  }
  if (!["owner", "admin", "approver", "viewer"].includes(role)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  const admin = createSupabaseAdminClient();

  const { data: tenant } = await admin
    .from("tenants")
    .select("id, name")
    .eq("slug", tenantSlug)
    .single();
  if (!tenant) return NextResponse.json({ error: "Tenant not found." }, { status: 404 });

  const { data: myMembership } = await supa
    .from("users_tenants")
    .select("role")
    .eq("tenant_id", tenant.id)
    .eq("user_id", auth.user.id)
    .maybeSingle();
  if (!myMembership || !["owner", "admin"].includes(myMembership.role as string)) {
    return NextResponse.json({ error: "Forbidden — you need owner or admin role." }, { status: 403 });
  }
  if (role === "owner" && myMembership.role !== "owner") {
    return NextResponse.json({ error: "Only an owner can grant the owner role." }, { status: 403 });
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");

  const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${baseUrl}/` },
  });
  if (linkError || !linkData?.user) {
    return NextResponse.json(
      { error: `Failed to generate invite link: ${linkError?.message}` },
      { status: 500 },
    );
  }

  const invitedUserId = linkData.user.id;
  const userCreated = !linkData.user.last_sign_in_at && !linkData.user.email_confirmed_at;

  await admin
    .from("users_tenants")
    .upsert(
      { user_id: invitedUserId, tenant_id: tenant.id, role },
      { onConflict: "user_id,tenant_id" },
    );

  return NextResponse.json({
    email,
    role,
    tenant: { slug: tenantSlug, name: tenant.name as string },
    invite_url: linkData.properties.action_link,
    user_created: userCreated,
    expires_in_hours: 24,
  });
}
