import { cookies } from "next/headers";
import { createSupabaseServerClient } from "./supabase-server";

/**
 * Resolve the active tenant for this request.
 * Priority: cookie `active_tenant` → first tenant the user belongs to.
 * Returns null if user isn't authed or has no tenants.
 */
export async function getActiveTenant() {
  const supa = createSupabaseServerClient();
  const { data: auth } = await supa.auth.getUser();
  if (!auth.user) return null;

  const cookieTenant = cookies().get("active_tenant")?.value;
  const { data: memberships } = await supa
    .from("users_tenants")
    .select("tenant_id, role, tenants(id, slug, name, settings, plan)")
    .eq("user_id", auth.user.id);

  if (!memberships?.length) return null;

  const preferred =
    memberships.find((m) => (m.tenants as { slug: string }).slug === cookieTenant) ??
    memberships[0];

  const t = preferred.tenants as {
    id: string;
    slug: string;
    name: string;
    settings: Record<string, unknown>;
    plan: string;
  };

  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    role: preferred.role as "owner" | "admin" | "approver" | "viewer",
    plan: t.plan,
    settings: t.settings,
    user: auth.user,
    memberships: memberships.map((m) => m.tenants as { id: string; slug: string; name: string }),
  };
}
