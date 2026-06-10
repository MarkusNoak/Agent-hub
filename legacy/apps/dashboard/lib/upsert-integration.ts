"use server";

import { createSupabaseAdminClient } from "./supabase-server";
import type { SupabaseClient } from "@supabase/supabase-js";

type IntegrationRow = {
  tenant_id: string;
  kind: string;
  label: string;
  status: string;
  credentials: Record<string, unknown>;
  config: Record<string, unknown>;
  last_synced_at: string;
};

/**
 * Save or update an integration row without relying on ON CONFLICT —
 * the integrations table may not have a composite unique index yet.
 *
 * Conflict key: (tenant_id, kind) for single-account integrations,
 *               (tenant_id, kind, label) for multi-account ones (e.g. Gmail).
 */
export async function upsertIntegration(
  row: IntegrationRow,
  opts: { multiAccount?: boolean } = {},
): Promise<{ error: { message: string } | null }> {
  const admin = createSupabaseAdminClient() as SupabaseClient;

  let query = admin
    .from("integrations")
    .select("id")
    .eq("tenant_id", row.tenant_id)
    .eq("kind", row.kind);

  if (opts.multiAccount) {
    query = query.eq("label", row.label);
  }

  const { data: existing } = await query.maybeSingle();

  if (existing) {
    const { error } = await admin
      .from("integrations")
      .update({
        label: row.label,
        status: row.status,
        credentials: row.credentials,
        config: row.config,
        last_synced_at: row.last_synced_at,
      })
      .eq("id", (existing as { id: string }).id);
    return { error: error ? { message: error.message } : null };
  } else {
    const { error } = await admin.from("integrations").insert(row);
    return { error: error ? { message: error.message } : null };
  }
}
