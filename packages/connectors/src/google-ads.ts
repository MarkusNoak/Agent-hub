import type { Connector, ConnectorFactory, IntegrationKind, TenantContext } from "@agent-hub/core";

export interface CampaignStats {
  campaign_id: string;
  campaign_name: string;
  status: string;
  impressions: number;
  clicks: number;
  ctr: number;
  cost_usd: number;
  conversions: number;
  avg_cpc_usd: number;
  conversion_rate: number;
}

export interface AdGroupStats {
  ad_group_id: string;
  ad_group_name: string;
  campaign_name: string;
  impressions: number;
  clicks: number;
  cost_usd: number;
  conversions: number;
}

export interface KeywordStats {
  keyword_text: string;
  match_type: string;
  impressions: number;
  clicks: number;
  cost_usd: number;
  avg_cpc_usd: number;
  quality_score: number | null;
}

export interface GoogleAdsConnector extends Connector {
  getCampaignPerformance(customerId: string, period?: "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_MONTH"): Promise<CampaignStats[]>;
  getAdGroupPerformance(customerId: string, campaignId?: string, period?: "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_MONTH"): Promise<AdGroupStats[]>;
  getTopKeywords(customerId: string, period?: "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_MONTH"): Promise<KeywordStats[]>;
}

interface GoogleAdsCreds {
  client_id: string;
  client_secret: string;
  refresh_token: string;
  developer_token: string;
  /** Optional login-customer-id for MCC accounts */
  login_customer_id?: string;
}

class GoogleAdsClient implements GoogleAdsConnector {
  readonly kind: IntegrationKind = "google_ads";
  private accessToken: string | null = null;
  private tokenExpiry = 0;

  constructor(
    readonly tenant: TenantContext,
    private readonly creds: GoogleAdsCreds,
  ) {}

  async healthcheck() {
    try {
      await this.getAccessToken();
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  private async getAccessToken(): Promise<string> {
    if (this.accessToken && Date.now() < this.tokenExpiry) return this.accessToken;
    const resp = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.creds.client_id,
        client_secret: this.creds.client_secret,
        refresh_token: this.creds.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!resp.ok) throw new Error(`Google OAuth failed: ${await resp.text()}`);
    const body = (await resp.json()) as { access_token: string; expires_in: number };
    this.accessToken = body.access_token;
    this.tokenExpiry = Date.now() + (body.expires_in - 60) * 1000;
    return this.accessToken;
  }

  private async gaqlSearch<T>(customerId: string, query: string): Promise<T[]> {
    const token = await this.getAccessToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      "developer-token": this.creds.developer_token,
      "Content-Type": "application/json",
    };
    if (this.creds.login_customer_id) {
      headers["login-customer-id"] = this.creds.login_customer_id;
    }
    const resp = await fetch(
      `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
      { method: "POST", headers, body: JSON.stringify({ query }) },
    );
    if (!resp.ok) throw new Error(`Google Ads API ${resp.status}: ${await resp.text()}`);
    const body = (await resp.json()) as { results?: T[] };
    return body.results ?? [];
  }

  async getCampaignPerformance(customerId: string, period: "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_MONTH" = "LAST_30_DAYS"): Promise<CampaignStats[]> {
    const rows = await this.gaqlSearch<GoogleAdsRow>(customerId, `
      SELECT
        campaign.id, campaign.name, campaign.status,
        metrics.impressions, metrics.clicks, metrics.ctr,
        metrics.cost_micros, metrics.conversions, metrics.average_cpc
      FROM campaign
      WHERE segments.date DURING ${period}
        AND campaign.status != 'REMOVED'
      ORDER BY metrics.cost_micros DESC
      LIMIT 25
    `);
    return rows.map((r) => ({
      campaign_id: String(r.campaign?.id ?? ""),
      campaign_name: String(r.campaign?.name ?? ""),
      status: String(r.campaign?.status ?? ""),
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      ctr: Number(r.metrics?.ctr ?? 0),
      cost_usd: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
      conversions: Number(r.metrics?.conversions ?? 0),
      avg_cpc_usd: Number(r.metrics?.averageCpc ?? 0) / 1_000_000,
      conversion_rate: r.metrics?.clicks
        ? Number(r.metrics.conversions ?? 0) / Number(r.metrics.clicks)
        : 0,
    }));
  }

  async getAdGroupPerformance(customerId: string, campaignId?: string, period: "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_MONTH" = "LAST_30_DAYS"): Promise<AdGroupStats[]> {
    const campaignFilter = campaignId ? `AND campaign.id = ${campaignId}` : "";
    const rows = await this.gaqlSearch<GoogleAdsRow>(customerId, `
      SELECT
        ad_group.id, ad_group.name, campaign.name,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions
      FROM ad_group
      WHERE segments.date DURING ${period}
        AND ad_group.status != 'REMOVED'
        ${campaignFilter}
      ORDER BY metrics.cost_micros DESC
      LIMIT 20
    `);
    return rows.map((r) => ({
      ad_group_id: String(r.adGroup?.id ?? ""),
      ad_group_name: String(r.adGroup?.name ?? ""),
      campaign_name: String(r.campaign?.name ?? ""),
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      cost_usd: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
      conversions: Number(r.metrics?.conversions ?? 0),
    }));
  }

  async getTopKeywords(customerId: string, period: "LAST_7_DAYS" | "LAST_30_DAYS" | "LAST_MONTH" = "LAST_30_DAYS"): Promise<KeywordStats[]> {
    const rows = await this.gaqlSearch<GoogleAdsRow>(customerId, `
      SELECT
        ad_group_criterion.keyword.text,
        ad_group_criterion.keyword.match_type,
        ad_group_criterion.quality_info.quality_score,
        metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.average_cpc
      FROM keyword_view
      WHERE segments.date DURING ${period}
        AND ad_group_criterion.status != 'REMOVED'
      ORDER BY metrics.clicks DESC
      LIMIT 30
    `);
    return rows.map((r) => ({
      keyword_text: String(r.adGroupCriterion?.keyword?.text ?? ""),
      match_type: String(r.adGroupCriterion?.keyword?.matchType ?? ""),
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      cost_usd: Number(r.metrics?.costMicros ?? 0) / 1_000_000,
      avg_cpc_usd: Number(r.metrics?.averageCpc ?? 0) / 1_000_000,
      quality_score: r.adGroupCriterion?.qualityInfo?.qualityScore ?? null,
    }));
  }
}

interface GoogleAdsRow {
  campaign?: { id?: string | number; name?: string; status?: string };
  adGroup?: { id?: string | number; name?: string };
  adGroupCriterion?: {
    keyword?: { text?: string; matchType?: string };
    qualityInfo?: { qualityScore?: number };
  };
  metrics?: {
    impressions?: string | number;
    clicks?: string | number;
    ctr?: string | number;
    costMicros?: string | number;
    conversions?: string | number;
    averageCpc?: string | number;
  };
}

export const googleAdsFactory: ConnectorFactory<GoogleAdsConnector> = {
  kind: "google_ads",
  async create({ tenant, credentials }) {
    return new GoogleAdsClient(tenant, credentials as unknown as GoogleAdsCreds);
  },
};
