import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-server";
import { AGENT_REGISTRY } from "@agent-hub/agents";
import { loadTenantConnectors } from "@agent-hub/connectors";
import { executeAgent, loadTenant } from "@agent-hub/core";
import type { GithubConnector } from "@agent-hub/connectors";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

interface PRWebhookPayload {
  action: string;
  number: number;
  pull_request: {
    number: number;
    title: string;
    base: { repo: { full_name: string } };
    draft: boolean;
  };
  repository: { full_name: string };
  installation?: { id: number };
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const event = req.headers.get("x-github-event");
  const signature = req.headers.get("x-hub-signature-256") ?? "";
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;

  // Verify signature if secret is configured
  if (webhookSecret) {
    const crypto = await import("crypto");
    const expected = "sha256=" + crypto.createHmac("sha256", webhookSecret).update(rawBody).digest("hex");
    const sigBuffer = Buffer.from(signature);
    const expBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expBuffer.length || !crypto.timingSafeEqual(sigBuffer, expBuffer)) {
      return NextResponse.json({ error: "invalid signature" }, { status: 401 });
    }
  }

  // Only handle pull_request events with opened/synchronize actions
  if (event !== "pull_request") {
    return NextResponse.json({ ok: true, skipped: `event=${event}` });
  }

  const payload = JSON.parse(rawBody) as PRWebhookPayload;
  if (!["opened", "synchronize"].includes(payload.action)) {
    return NextResponse.json({ ok: true, skipped: `action=${payload.action}` });
  }

  // Skip draft PRs
  if (payload.pull_request.draft) {
    return NextResponse.json({ ok: true, skipped: "draft pr" });
  }

  const repo = payload.repository.full_name;
  const prNumber = payload.number;

  // Find tenants that have GitHub configured and match this repo org
  const admin = createSupabaseAdminClient();
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, slug, name, settings, plan");

  if (!tenants?.length) {
    return NextResponse.json({ ok: true, skipped: "no tenants" });
  }

  const agentDef = AGENT_REGISTRY["dev_support"];
  if (!agentDef) return NextResponse.json({ ok: true, skipped: "no dev_support agent" });

  // Check which tenants have a dev_support agent enabled
  const { data: agents } = await admin
    .from("agents")
    .select("id, tenant_id, kind")
    .eq("kind", "dev_support")
    .eq("status", "enabled");

  const enabledTenantIds = new Set((agents ?? []).map((a) => a.tenant_id));

  for (const tenantRow of tenants) {
    if (!enabledTenantIds.has(tenantRow.id)) continue;

    try {
      const tenant = await loadTenant(admin as never, tenantRow.slug);
      const connectors = await loadTenantConnectors(admin as never, tenant);
      const gh = connectors.github as GithubConnector | undefined;
      if (!gh) continue;

      void executeAgent({
        tenant,
        agent: agentDef,
        input: { pr_repo: repo, pr_number: prNumber },
        trigger: "webhook",
        connectors,
        supabase: admin as never,
      });
    } catch (e) {
      console.error("PR review dispatch failed", tenantRow.slug, e);
    }
  }

  return NextResponse.json({ ok: true, repo, pr: prNumber });
}

export async function GET() {
  return NextResponse.json({ ok: true, service: "github-webhook" });
}
