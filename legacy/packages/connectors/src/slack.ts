import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface SlackConnector extends Connector {
  postMessage(channel: string, text: string, blocks?: unknown[]): Promise<{ ts: string }>;
  findUserByEmail(email: string): Promise<{ id: string; name: string } | null>;
}

class SlackClient implements SlackConnector {
  readonly kind: IntegrationKind = "slack";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { bot_token: string },
  ) {}

  private async fetch(method: string, body?: Record<string, unknown>) {
    const resp = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.creds.bot_token}`,
        "Content-Type": "application/json; charset=utf-8",
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = (await resp.json()) as { ok: boolean; error?: string; [k: string]: unknown };
    if (!data.ok) throw new Error(`Slack ${method}: ${data.error}`);
    return data;
  }

  async healthcheck() {
    try {
      await this.fetch("auth.test");
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async postMessage(channel: string, text: string, blocks?: unknown[]) {
    const data = await this.fetch("chat.postMessage", { channel, text, blocks });
    return { ts: data.ts as string };
  }

  async findUserByEmail(email: string) {
    try {
      const data = await this.fetch("users.lookupByEmail", { email });
      const u = data.user as { id: string; name: string } | undefined;
      return u ? { id: u.id, name: u.name } : null;
    } catch {
      return null;
    }
  }
}

export const slackFactory: ConnectorFactory<SlackConnector> = {
  kind: "slack",
  async create({ tenant, credentials }) {
    return new SlackClient(tenant, credentials as SlackClient["creds"]);
  },
};
