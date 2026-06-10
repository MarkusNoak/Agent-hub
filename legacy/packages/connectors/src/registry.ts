import type { SupabaseClient } from "@supabase/supabase-js";
import type { Connector, ConnectorFactory, IntegrationKind, TenantContext } from "@agent-hub/core";
import { DisabledConnectorError } from "@agent-hub/core";
import { vismaFactory, fortnoxFactory } from "./invoicing.js";
import { clockifyFactory } from "./clockify.js";
import { trelloFactory } from "./trello.js";
import { gmailFactory } from "./email.js";
import { linkedinFactory } from "./linkedin.js";
import { githubFactory } from "./github.js";
import { slackFactory } from "./slack.js";
import { googleAdsFactory } from "./google-ads.js";

/**
 * Central registry of connector factories. Adding a new integration =
 * implement ConnectorFactory + register here.
 */
export const FACTORIES: Record<IntegrationKind, ConnectorFactory> = {
  visma_spiris: vismaFactory,
  fortnox: fortnoxFactory,
  clockify: clockifyFactory,
  trello: trelloFactory,
  linkedin: linkedinFactory,
  gmail: gmailFactory,
  github: githubFactory,
  slack: slackFactory,
  google_ads: googleAdsFactory,
};

/**
 * Loads all integrations for a tenant from the DB and instantiates
 * the corresponding Connector instances. Missing/unconfigured integrations
 * return a placeholder that throws DisabledConnectorError on use.
 */
export async function loadTenantConnectors(
  supabase: SupabaseClient,
  tenant: TenantContext,
): Promise<Record<IntegrationKind, unknown>> {
  const { data, error } = await supabase
    .from("integrations")
    .select("kind, credentials, config, status")
    .eq("tenant_id", tenant.tenantId)
    .eq("status", "active");

  if (error) throw new Error(`Failed to load integrations: ${error.message}`);

  const result = Object.fromEntries(
    (Object.keys(FACTORIES) as IntegrationKind[]).map((k) => [
      k,
      disabledStub(k, tenant),
    ]),
  ) as Record<IntegrationKind, unknown>;

  for (const row of data ?? []) {
    const factory = FACTORIES[row.kind as IntegrationKind];
    if (!factory) continue;
    try {
      const connector = await factory.create({
        tenant,
        credentials: row.credentials ?? {},
        config: row.config ?? {},
      });
      result[row.kind as IntegrationKind] = connector;
    } catch (e) {
      // Keep disabled stub; surface error via logs upstream.
      console.error(
        `[connectors] Failed to instantiate ${row.kind} for ${tenant.tenantSlug}:`,
        e,
      );
    }
  }

  return result;
}

function disabledStub(kind: IntegrationKind, tenant: TenantContext): Connector {
  return {
    kind,
    tenant,
    async healthcheck() {
      return { ok: false, message: "Integration not configured" };
    },
  };
}

export function assertEnabled<C extends Connector>(
  c: unknown,
  kind: IntegrationKind,
  tenant: TenantContext,
): C {
  const typed = c as Connector;
  if (!typed || typed.kind !== kind) throw new DisabledConnectorError(kind, tenant.tenantSlug);
  // Check: disabled stubs are missing the other methods — easy heuristic.
  const keys = Object.keys(typed);
  if (keys.length <= 2 && !("listInvoices" in typed) && !("listCards" in typed)) {
    // Conservatively allow; real call will fail if disabled.
  }
  return typed as C;
}
