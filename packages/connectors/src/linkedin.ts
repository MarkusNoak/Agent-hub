import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface LinkedInConnector extends Connector {
  /** Drafts a post — never publishes directly. Actual publish is via approval queue. */
  draftPost(opts: {
    body: string;
    visibility?: "PUBLIC" | "CONNECTIONS";
  }): Promise<{ draft: { body: string; visibility: string; preview_url?: string } }>;

  publishPost(opts: { body: string; visibility?: "PUBLIC" | "CONNECTIONS" }): Promise<{ post_id: string }>;
}

class LinkedInClient implements LinkedInConnector {
  readonly kind: IntegrationKind = "linkedin";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { access_token: string; author_urn: string },
  ) {}

  async healthcheck() {
    try {
      const resp = await fetch("https://api.linkedin.com/v2/me", {
        headers: { Authorization: `Bearer ${this.creds.access_token}` },
      });
      return { ok: resp.ok };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async draftPost(opts: { body: string; visibility?: "PUBLIC" | "CONNECTIONS" }) {
    return {
      draft: {
        body: opts.body,
        visibility: opts.visibility ?? "PUBLIC",
      },
    };
  }

  async publishPost(opts: { body: string; visibility?: "PUBLIC" | "CONNECTIONS" }) {
    const payload = {
      author: this.creds.author_urn,
      lifecycleState: "PUBLISHED",
      specificContent: {
        "com.linkedin.ugc.ShareContent": {
          shareCommentary: { text: opts.body },
          shareMediaCategory: "NONE",
        },
      },
      visibility: {
        "com.linkedin.ugc.MemberNetworkVisibility": opts.visibility ?? "PUBLIC",
      },
    };
    const resp = await fetch("https://api.linkedin.com/v2/ugcPosts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.creds.access_token}`,
        "Content-Type": "application/json",
        "X-Restli-Protocol-Version": "2.0.0",
      },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) throw new Error(`LinkedIn ${resp.status}: ${await resp.text()}`);
    const body = (await resp.json()) as { id: string };
    return { post_id: body.id };
  }
}

export const linkedinFactory: ConnectorFactory<LinkedInConnector> = {
  kind: "linkedin",
  async create({ tenant, credentials }) {
    return new LinkedInClient(tenant, credentials as LinkedInClient["creds"]);
  },
};
