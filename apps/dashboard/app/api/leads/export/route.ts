import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { getActiveTenant } from "@/lib/tenant";

export const dynamic = "force-dynamic";

export async function GET() {
  const tenant = await getActiveTenant();
  if (!tenant) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supa = createSupabaseServerClient();
  const { data: leads, error } = await supa
    .from("leads")
    .select(
      "company_name, company_domain, contact_name, contact_email, contact_linkedin, signal_type, signal_summary, offer_type, stage, score, created_at, updated_at",
    )
    .eq("tenant_id", tenant.id)
    .order("updated_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const headers = [
    "Bolag",
    "Domän",
    "Kontaktperson",
    "E-post",
    "LinkedIn",
    "Signaltyp",
    "Signal-sammanfattning",
    "Erbjudande",
    "Stage",
    "Score",
    "Tillagd",
    "Uppdaterad",
  ];

  function escape(val: unknown): string {
    const s = val == null ? "" : String(val);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  const rows = (leads ?? []).map((l) =>
    [
      l.company_name,
      l.company_domain,
      l.contact_name,
      l.contact_email,
      l.contact_linkedin,
      l.signal_type,
      l.signal_summary,
      l.offer_type,
      l.stage,
      l.score,
      l.created_at,
      l.updated_at,
    ]
      .map(escape)
      .join(","),
  );

  const csv = [headers.join(","), ...rows].join("\n");
  const filename = `leads-${tenant.slug}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
