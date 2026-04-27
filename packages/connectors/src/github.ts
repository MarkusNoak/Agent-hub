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

export interface PRDetails {
  number: number;
  title: string;
  body: string;
  author: string;
  base_branch: string;
  head_branch: string;
  changed_files: number;
  additions: number;
  deletions: number;
  url: string;
}

export interface PRFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  patch: string;
}

export interface GithubConnector extends Connector {
  searchIssues(q: string, repo?: string): Promise<GithubIssue[]>;
  listRepoDocs(repo: string, path?: string): Promise<Array<{ path: string; url: string }>>;
  readFile(repo: string, path: string): Promise<string>;
  getPR(repo: string, prNumber: number): Promise<PRDetails>;
  getPRFiles(repo: string, prNumber: number): Promise<PRFile[]>;
  createPRReview(repo: string, prNumber: number, body: string, event?: "COMMENT" | "APPROVE" | "REQUEST_CHANGES"): Promise<void>;
  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean;
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

  async getPR(repo: string, prNumber: number): Promise<PRDetails> {
    const resp = await this.fetch(`/repos/${repo}/pulls/${prNumber}`);
    const pr = (await resp.json()) as {
      number: number; title: string; body: string | null;
      user: { login: string }; base: { ref: string }; head: { ref: string };
      changed_files: number; additions: number; deletions: number; html_url: string;
    };
    return {
      number: pr.number,
      title: pr.title,
      body: pr.body ?? "",
      author: pr.user.login,
      base_branch: pr.base.ref,
      head_branch: pr.head.ref,
      changed_files: pr.changed_files,
      additions: pr.additions,
      deletions: pr.deletions,
      url: pr.html_url,
    };
  }

  async getPRFiles(repo: string, prNumber: number): Promise<PRFile[]> {
    const resp = await this.fetch(`/repos/${repo}/pulls/${prNumber}/files`);
    const files = (await resp.json()) as Array<{
      filename: string; status: string;
      additions: number; deletions: number; patch?: string;
    }>;
    return files.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: (f.patch ?? "").slice(0, 4000),
    }));
  }

  async createPRReview(repo: string, prNumber: number, body: string, event: "COMMENT" | "APPROVE" | "REQUEST_CHANGES" = "COMMENT") {
    await this.fetch(`/repos/${repo}/pulls/${prNumber}/reviews`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ body, event }),
    });
  }

  verifyWebhookSignature(payload: string, signature: string, secret: string): boolean {
    const crypto = require("crypto") as typeof import("crypto");
    const expected = "sha256=" + crypto.createHmac("sha256", secret).update(payload).digest("hex");
    try {
      return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    } catch {
      return false;
    }
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
