import type { Connector, ConnectorFactory } from "@agent-hub/core";
import type { IntegrationKind, TenantContext } from "@agent-hub/core";

export interface GithubIssue {
  id: number;
  number: number;
  title: string;
  body: string;
  state: "open" | "closed";
  labels: string[];
  repo: string;
  url: string;
}

export interface GithubConnector extends Connector {
  searchIssues(q: string, repo?: string): Promise<GithubIssue[]>;
  listRepoDocs(repo: string, path?: string): Promise<Array<{ path: string; url: string }>>;
  readFile(repo: string, path: string): Promise<string>;
}

class GithubClient implements GithubConnector {
  readonly kind: IntegrationKind = "github";
  constructor(
    readonly tenant: TenantContext,
    private readonly creds: { token: string; org?: string },
  ) {}

  private async fetch(path: string, init: RequestInit = {}) {
    const resp = await fetch(`https://api.github.com${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.creds.token}`,
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        ...(init.headers ?? {}),
      },
    });
    if (!resp.ok) throw new Error(`GitHub ${resp.status}: ${await resp.text()}`);
    return resp;
  }

  async healthcheck() {
    try {
      await this.fetch("/user");
      return { ok: true };
    } catch (e) {
      return { ok: false, message: (e as Error).message };
    }
  }

  async searchIssues(q: string, repo?: string) {
    const qs = new URLSearchParams({
      q: repo ? `${q} repo:${repo}` : q,
    });
    const resp = await this.fetch(`/search/issues?${qs}`);
    const body = (await resp.json()) as { items: GithubIssueRow[] };
    return body.items.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      body: r.body ?? "",
      state: r.state,
      labels: r.labels.map((l) => l.name),
      repo: r.repository_url.split("/").slice(-2).join("/"),
      url: r.html_url,
    }));
  }

  async listRepoDocs(repo: string, path = "docs") {
    const resp = await this.fetch(`/repos/${repo}/contents/${path}`);
    const rows = (await resp.json()) as Array<{ path: string; html_url: string; type: string }>;
    return rows
      .filter((r) => r.type === "file" && /\.(md|mdx|txt)$/.test(r.path))
      .map((r) => ({ path: r.path, url: r.html_url }));
  }

  async readFile(repo: string, path: string) {
    const resp = await this.fetch(`/repos/${repo}/contents/${path}`);
    const body = (await resp.json()) as { content: string; encoding: string };
    if (body.encoding !== "base64") throw new Error(`Unexpected encoding ${body.encoding}`);
    return Buffer.from(body.content, "base64").toString("utf8");
  }
}

interface GithubIssueRow {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: "open" | "closed";
  labels: Array<{ name: string }>;
  repository_url: string;
  html_url: string;
}

export const githubFactory: ConnectorFactory<GithubConnector> = {
  kind: "github",
  async create({ tenant, credentials }) {
    return new GithubClient(tenant, credentials as GithubClient["creds"]);
  },
};
