import { NextResponse, type NextRequest } from "next/server";

// TEMPORARY bootstrap route. Used ONCE to log in Markus + generate Lucas' invite
// while we're locked out by Supabase's email rate limit. Delete this file after
// both humans are inside the dashboard.
//
// Usage:
//   GET /auth/bootstrap?secret=...&email=you@co.se&tenantSlug=we-know-it&role=owner
//       → 302 redirect to the Supabase magic-link (logs the browser in as `email`).
//   GET /auth/bootstrap?secret=...&email=other@co.se&mode=show&tenantSlug=...&role=admin
//       → HTML page showing the generated invite URL so you can copy + share.
//
// Security: the secret is shared between this route and the bootstrap-invite
// edge function. Both go away as soon as we can send mail (or via Supabase SMTP
// config) — this is explicitly a break-glass mechanism.

const SECRET = "bootstrap-ZM3NgR7vK4qYx8tD2eP1wB9sL6cF0jHnU-emergency";

export const dynamic = "force-dynamic";

type EdgeResponse = {
  email?: string;
  user_id?: string;
  user_created?: boolean;
  invite_url?: string;
  error?: string;
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const secret = url.searchParams.get("secret");
  const email = url.searchParams.get("email");
  const tenantSlug = url.searchParams.get("tenantSlug") ?? "we-know-it";
  const role = url.searchParams.get("role") ?? "admin";
  const mode = url.searchParams.get("mode") ?? "redirect";

  if (secret !== SECRET) {
    return new NextResponse("forbidden", { status: 403 });
  }
  if (!email) {
    return new NextResponse("email required", { status: 400 });
  }

  const supaUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

  const res = await fetch(`${supaUrl}/functions/v1/bootstrap-invite`, {
    method: "POST",
    headers: {
      apikey: anon,
      Authorization: `Bearer ${anon}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, secret: SECRET, tenantSlug, role }),
    cache: "no-store",
  });

  const json = (await res.json().catch(() => ({}))) as EdgeResponse;

  if (!res.ok || !json.invite_url) {
    return new NextResponse(
      `bootstrap failed: ${json.error ?? `HTTP ${res.status}`}`,
      { status: 500 },
    );
  }

  if (mode === "redirect") {
    return NextResponse.redirect(json.invite_url, 302);
  }

  // mode=show → return a simple copy-friendly HTML page.
  const safeEmail = email.replace(/</g, "&lt;");
  const safeUrl = json.invite_url.replace(/"/g, "&quot;");
  const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>Bootstrap invite</title>
  <style>
    body { font-family: Inter, system-ui, sans-serif; max-width: 720px; margin: 6rem auto; padding: 0 1.5rem; color: #111318; }
    h1 { font-size: 1.25rem; margin-bottom: 0.5rem; }
    p { color: #6b6f78; margin: 0 0 1rem; }
    textarea { width: 100%; min-height: 140px; font-family: ui-monospace, monospace; font-size: 0.8rem; padding: 0.75rem; border: 1px solid #d6d8dc; border-radius: 0.5rem; }
    .row { display: flex; gap: 0.5rem; margin-top: 1rem; }
    button, a.btn { background: #0b5cff; color: white; padding: 0.6rem 1rem; border-radius: 0.5rem; border: 0; cursor: pointer; text-decoration: none; font-weight: 500; }
    a.btn.secondary { background: #ebecee; color: #111318; }
    .meta { font-size: 0.75rem; color: #6b6f78; margin-top: 1rem; }
  </style>
</head>
<body>
  <h1>Invite link for ${safeEmail}</h1>
  <p>${json.user_created ? "New user created." : "Existing user."} Role: ${role}. Tenant: ${tenantSlug}. Expires in ~1 hour.</p>
  <textarea readonly onclick="this.select()">${safeUrl}</textarea>
  <div class="row">
    <button onclick="navigator.clipboard.writeText(document.querySelector('textarea').value); this.textContent='Copied';">Copy URL</button>
    <a class="btn secondary" href="${safeUrl}">Open link in this tab</a>
  </div>
  <p class="meta">Share this link via Slack/DM. The recipient clicks it and is signed in directly.</p>
</body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}
