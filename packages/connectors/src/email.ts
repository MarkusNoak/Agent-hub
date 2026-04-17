import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface EmailMessage {
  to: string;
  cc?: string[];
  subject: string;
  body_html: string;
  body_text?: string;
  reply_to?: string;
}

export interface EmailConnector extends Connector {
  sendEmail(msg: EmailMessage): Promise<{ message_id: string }>;
  createDraft(msg: EmailMessage): Promise<{ draft_id: string }>;
}

class GmailConnector implements EmailConnector {
  readonly kind: IntegrationKind = "gmail";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { access_token: string; from: string; refresh_token?: string },
  ) {}

  async healthcheck() {
    try {
      const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", {
        headers: { Authorization: `Bearer ${this.creds.access_token}` },
      });
      return { ok: resp.ok };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  private encode(msg: EmailMessage): string {
    const headers = [
      `From: ${this.creds.from}`,
      `To: ${msg.to}`,
      msg.cc?.length ? `Cc: ${msg.cc.join(", ")}` : "",
      msg.reply_to ? `Reply-To: ${msg.reply_to}` : "",
      `Subject: ${msg.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/html; charset=UTF-8",
      "",
      msg.body_html,
    ]
      .filter(Boolean)
      .join("\r\n");
    return Buffer.from(headers).toString("base64url");
  }

  async sendEmail(msg: EmailMessage) {
    const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.creds.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw: this.encode(msg) }),
    });
    if (!resp.ok) throw new Error(`Gmail ${resp.status}: ${await resp.text()}`);
    const body = (await resp.json()) as { id: string };
    return { message_id: body.id };
  }

  async createDraft(msg: EmailMessage) {
    const resp = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/drafts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.creds.access_token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ message: { raw: this.encode(msg) } }),
    });
    if (!resp.ok) throw new Error(`Gmail draft ${resp.status}: ${await resp.text()}`);
    const body = (await resp.json()) as { id: string };
    return { draft_id: body.id };
  }
}

export const gmailFactory: ConnectorFactory<EmailConnector> = {
  kind: "gmail",
  async create({ tenant, credentials }) {
    return new GmailConnector(tenant, credentials as GmailConnector["creds"]);
  },
};
