import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface AdCampaignStats {
  campaign_id: string;
  campaign_name: string;
  impressions: number;
  clicks: number;
  ctr: number;
  spend_usd: number;
  conversions: number;
  cost_per_click: number;
}

export interface OrganicPostStats {
  post_id: string;
  text_snippet: string;
  impressions: number;
  reactions: number;
  comments: number;
  shares: number;
  engagement_rate: number;
  published_at: string;
}

export interface LinkedInConnector extends Connector {
  draftPost(opts: { body: string; visibility?: "PUBLIC" | "CONNECTIONS" }): Promise<{ draft: { body: string; visibility: string } }>;
  publishPost(opts: { body: string; visibility?: "PUBLIC" | "CONNECTIONS" }): Promise<{ post_id: string }>;
  getAdCampaignStats(accountId: string, dateRange: { start: string; end: string }): Promise<AdCampaignStats[]>;
  getOrganicPostStats(count?: number): Promise<OrganicPostStats[]>;
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

  async getAdCampaignStats(accountId: string, dateRange: { start: string; end: string }): Promise<AdCampaignStats[]> {
    const qs = new URLSearchParams({
      q: "analytics",
      pivot: "CAMPAIGN",
      dateRange: JSON.stringify({ start: { year: parseInt(dateRange.start.slice(0, 4)), month: parseInt(dateRange.start.slice(5, 7)), day: parseInt(dateRange.start.slice(8, 10)) }, end: { year: parseInt(dateRange.end.slice(0, 4)), month: parseInt(dateRange.end.slice(5, 7)), day: parseInt(dateRange.end.slice(8, 10)) } }),
      accounts: `urn:li:sponsoredAccount:${accountId}`,
      fields: "campaign,impressions,clicks,costInUsd,externalWebsiteConversions",
    });
    try {
      const resp = await fetch(`https://api.linkedin.com/v2/adAnalytics?${qs}`, {
        headers: { Authorization: `Bearer ${this.creds.access_token}`, "LinkedIn-Version": "202401" },
      });
      if (!resp.ok) return [];
      const body = (await resp.json()) as { elements: AdAnalyticsRow[] };
      return (body.elements ?? []).map((el) => ({
        campaign_id: el.campaign ?? "",
        campaign_name: el.campaign ?? "",
        impressions: el.impressions ?? 0,
        clicks: el.clicks ?? 0,
        ctr: el.impressions ? (el.clicks ?? 0) / el.impressions : 0,
        spend_usd: el.costInUsd ?? 0,
        conversions: el.externalWebsiteConversions ?? 0,
        cost_per_click: el.clicks ? (el.costInUsd ?? 0) / el.clicks : 0,
      }));
    } catch {
      return [];
    }
  }

  async getOrganicPostStats(count = 10): Promise<OrganicPostStats[]> {
    try {
      const resp = await fetch(
        `https://api.linkedin.com/v2/ugcPosts?q=authors&authors=List(${encodeURIComponent(this.creds.author_urn)})&count=${count}`,
        { headers: { Authorization: `Bearer ${this.creds.access_token}` } },
      );
      if (!resp.ok) return [];
      const body = (await resp.json()) as { elements: UgcPostRow[] };
      return (body.elements ?? []).map((el) => ({
        post_id: el.id,
        text_snippet: (el.specificContent?.["com.linkedin.ugc.ShareContent"]?.shareCommentary?.text ?? "").slice(0, 100),
        impressions: 0,
        reactions: 0,
        comments: 0,
        shares: 0,
        engagement_rate: 0,
        published_at: new Date(el.created?.time ?? 0).toISOString(),
      }));
    } catch {
      return [];
    }
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

interface AdAnalyticsRow {
  campaign?: string;
  impressions?: number;
  clicks?: number;
  costInUsd?: number;
  externalWebsiteConversions?: number;
}

interface UgcPostRow {
  id: string;
  specificContent?: { "com.linkedin.ugc.ShareContent"?: { shareCommentary?: { text?: string } } };
  created?: { time?: number };
}

export const linkedinFactory: ConnectorFactory<LinkedInConnector> = {
  kind: "linkedin",
  async create({ tenant, credentials }) {
    return new LinkedInClient(tenant, credentials as LinkedInClient["creds"]);
  },
};
