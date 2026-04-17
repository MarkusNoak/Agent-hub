import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Server-side Supabase client using the SERVICE_ROLE key.
 * RLS is bypassed — the runtime is responsible for filtering by tenant_id
 * on every query. Never expose this client to the browser.
 */
export function createServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set. " +
        "The service-role client is only safe on trusted servers.",
    );
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { "x-agent-hub": "service" } },
  });
}

/**
 * Tenant-scoped wrapper — wraps every table read/write with .eq('tenant_id', ...).
 * Use this inside agent tools instead of the raw client to avoid accidental leaks.
 */
export class TenantScopedDb {
  constructor(
    private readonly client: SupabaseClient,
    private readonly tenantId: string,
  ) {}

  from(table: string) {
    return {
      select: (cols = "*") =>
        this.client.from(table).select(cols).eq("tenant_id", this.tenantId),
      insert: <T extends Record<string, unknown>>(row: T | T[]) => {
        const rows = (Array.isArray(row) ? row : [row]).map((r) => ({
          ...r,
          tenant_id: this.tenantId,
        }));
        return this.client.from(table).insert(rows);
      },
      update: <T extends Record<string, unknown>>(row: T) =>
        this.client.from(table).update(row).eq("tenant_id", this.tenantId),
      delete: () =>
        this.client.from(table).delete().eq("tenant_id", this.tenantId),
    };
  }

  /** Escape hatch for when you need the raw client (e.g. RPC). */
  raw(): SupabaseClient {
    return this.client;
  }
}
