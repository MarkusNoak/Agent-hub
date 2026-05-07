import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export async function POST(req: Request) {
  const supa = createSupabaseServerClient();
  await supa.auth.signOut();
  return NextResponse.redirect(new URL("/login", new URL(req.url).origin));
}
