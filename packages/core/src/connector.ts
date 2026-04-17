import type { TenantContext, IntegrationKind } from "./types.js";

/**
 * Connector interface — ALL external integrations must implement this.
 *
 * A Connector is tenant-scoped: the factory receives credentials from
 * the `integrations` table for a specific tenant, and the returned
 * instance must only ever access data belonging to that tenant.
 */
export interface Connector {
  readonly kind: IntegrationKind;
  readonly tenant: TenantContext;

  /** Quick liveness check: can we talk to the API? */
  healthcheck(): Promise<{ ok: boolean; message?: string }>;

  /** Disposable resources (open connections, refresh tokens). */
  close?(): Promise<void>;
}

/**
 * Factory signature. Each connector exports one of these.
 * Runtime calls it once per (tenant, run) and passes the resulting
 * instance into the agent's ToolContext.
 */
export interface ConnectorFactory<C extends Connector = Connector> {
  kind: IntegrationKind;
  create(params: {
    tenant: TenantContext;
    credentials: Record<string, unknown>;
    config: Record<string, unknown>;
  }): Promise<C>;
}

/**
 * Helper: when a connector is missing, return a "disabled" stub so
 * agents don't crash — they just receive a clear error per tool call.
 */
export class DisabledConnectorError extends Error {
  constructor(kind: IntegrationKind, tenant: string) {
    super(
      `Integration "${kind}" is not configured for tenant "${tenant}". ` +
        `Add credentials in Settings → Integrations.`,
    );
    this.name = "DisabledConnectorError";
  }
}
