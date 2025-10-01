import { NextResponse } from "next/server";

import { getSupabaseAdminClient, saveLeadRunsToSupabase } from "@/lib/supabase";
import type { LeadScoreApiResponse } from "@/lib/types";

export async function GET() {
  const client = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ available: false, reason: "Supabase environment variables missing" });
  }

  try {
    const { error } = await client.from("lead_runs").select("id").limit(1);
    if (error) {
      return NextResponse.json({ available: false, reason: error.message });
    }
    return NextResponse.json({ available: true });
  } catch (error) {
    return NextResponse.json({ available: false, reason: (error as Error).message });
  }
}

export async function POST(request: Request) {
  const client = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 400 });
  }

  try {
    const payload = (await request.json()) as LeadScoreApiResponse & { user_id?: string };
    const result = await saveLeadRunsToSupabase(
      payload.leads ?? [],
      client,
      typeof payload.user_id === "string" && payload.user_id.trim() ? payload.user_id.trim() : null
    );

    if (!result.saved) {
      return NextResponse.json({ error: result.error ?? "Failed to save" }, { status: 400 });
    }

    return NextResponse.json({ ok: true, count: result.count });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
