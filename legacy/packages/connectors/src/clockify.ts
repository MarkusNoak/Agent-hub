import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface TimeEntry {
  id: string;
  user_id: string;
  user_name: string;
  project_id: string;
  project_name: string;
  description: string;
  start: string;
  end: string | null;
  duration_seconds: number;
  billable: boolean;
}

export interface ClockifyConnector extends Connector {
  listTimeEntries(params: {
    from: string;
    to: string;
    projectId?: string;
    userId?: string;
  }): Promise<TimeEntry[]>;
  getProjects(): Promise<Array<{ id: string; name: string; client?: string; estimate_hours?: number }>>;
  getBudgetUtilization(projectId: string): Promise<{
    project: string;
    estimate_hours: number;
    logged_hours: number;
    variance_pct: number;
  }>;
}

class ClockifyClient implements ClockifyConnector {
  readonly kind: IntegrationKind = "clockify";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { api_key: string; workspace_id: string },
  ) {}

  private async fetch(path: string, init: RequestInit = {}): Promise<Response> {
    const resp = await fetch(`https://api.clockify.me/api/v1${path}`, {
      ...init,
      headers: {
        "X-Api-Key": this.creds.api_key,
        "Content-Type": "application/json",
        ...(init.headers ?? {}),
      },
    });
    if (!resp.ok) throw new Error(`Clockify ${resp.status}: ${await resp.text()}`);
    return resp;
  }

  async healthcheck() {
    try {
      await this.fetch(`/workspaces/${this.creds.workspace_id}`);
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async listTimeEntries(params: { from: string; to: string; projectId?: string; userId?: string }) {
    const qs = new URLSearchParams({ start: params.from, end: params.to });
    if (params.projectId) qs.set("project", params.projectId);
    const user = params.userId ?? "me";
    const resp = await this.fetch(
      `/workspaces/${this.creds.workspace_id}/user/${user}/time-entries?${qs}`,
    );
    const rows = (await resp.json()) as ClockifyEntry[];
    return rows.map((r) => ({
      id: r.id,
      user_id: r.userId,
      user_name: r.userId, // Clockify basic entries don't embed name — resolve separately if needed.
      project_id: r.projectId ?? "",
      project_name: r.projectId ?? "",
      description: r.description,
      start: r.timeInterval.start,
      end: r.timeInterval.end,
      duration_seconds: parseIsoDurationSeconds(r.timeInterval.duration ?? "PT0S"),
      billable: r.billable,
    }));
  }

  async getProjects() {
    const resp = await this.fetch(`/workspaces/${this.creds.workspace_id}/projects`);
    const rows = (await resp.json()) as Array<{
      id: string;
      name: string;
      clientName?: string;
      estimate?: { estimate?: string };
    }>;
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      client: r.clientName,
      estimate_hours: r.estimate?.estimate ? parseIsoDurationSeconds(r.estimate.estimate) / 3600 : undefined,
    }));
  }

  async getBudgetUtilization(projectId: string) {
    const projects = await this.getProjects();
    const proj = projects.find((p) => p.id === projectId);
    if (!proj) throw new Error(`Project ${projectId} not found`);
    const estimate_hours = proj.estimate_hours ?? 0;

    // Pull all entries ever for this project — simplistic but fine for small projects.
    const now = new Date().toISOString();
    const entries = await this.listTimeEntries({
      from: "2020-01-01T00:00:00Z",
      to: now,
      projectId,
    });
    const logged_hours =
      entries.reduce((s, e) => s + e.duration_seconds, 0) / 3600;
    const variance_pct = estimate_hours
      ? ((logged_hours - estimate_hours) / estimate_hours) * 100
      : 0;
    return { project: proj.name, estimate_hours, logged_hours, variance_pct };
  }
}

interface ClockifyEntry {
  id: string;
  userId: string;
  projectId?: string;
  description: string;
  billable: boolean;
  timeInterval: { start: string; end: string | null; duration?: string };
}

function parseIsoDurationSeconds(d: string): number {
  // ISO 8601 durations like "PT1H30M45S"
  const m = /^P(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(d);
  if (!m) return 0;
  const [, h = "0", min = "0", s = "0"] = m;
  return (
    parseInt(h, 10) * 3600 +
    parseInt(min, 10) * 60 +
    parseInt(s, 10)
  );
}

export const clockifyFactory: ConnectorFactory<ClockifyConnector> = {
  kind: "clockify",
  async create({ tenant, credentials }) {
    return new ClockifyClient(tenant, credentials as ClockifyClient["creds"]);
  },
};
