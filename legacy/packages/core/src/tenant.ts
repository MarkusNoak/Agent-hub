import type { SupabaseClient } from "@supabase/supabase-js";
import type { TenantContext } from "./types.js";

/** Load a tenant by slug — throws if not found. */
export async function loadTenant(
  supabase: SupabaseClient,
  slug: string,
): Promise<TenantContext> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name, settings")
    .eq("slug", slug)
    .single();

  if (error || !data) throw new Error(`Tenant "${slug}" not found: ${error?.message}`);

  return {
    tenantId: data.id,
    tenantSlug: data.slug,
    tenantName: data.name,
    settings: (data.settings ?? {}) as Record<string, unknown>,
  };
}

/** List all tenants with at least one enabled agent (for scheduler). */
export async function listActiveTenants(supabase: SupabaseClient): Promise<TenantContext[]> {
  const { data, error } = await supabase
    .from("tenants")
    .select("id, slug, name, settings, agents!inner(status)")
    .eq("agents.status", "enabled");

  if (error) throw new Error(`Failed to list tenants: ${error.message}`);

  return (data ?? []).map((t) => ({
    tenantId: t.id,
    tenantSlug: t.slug,
    tenantName: t.name,
    settings: (t.settings ?? {}) as Record<string, unknown>,
  }));
}
