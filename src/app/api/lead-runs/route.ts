import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase";

export async function GET(request: Request) {
  const client = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase environment variables missing" }, { status: 500 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get("user_id");

    if (!userId) {
      return NextResponse.json({ error: "Missing user context" }, { status: 401 });
    }
    const interpretation = searchParams.get("interpretation");
    const industry = searchParams.get("industry");
    const minScore = searchParams.get("minScore");
    const maxScore = searchParams.get("maxScore");
    const search = searchParams.get("search");

    let query = client
      .from("lead_runs")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (interpretation && interpretation !== "all") {
      query = query.eq("interpretation", interpretation);
    }
    if (industry && industry !== "all") {
      query = query.ilike("industry", industry.replace(/%/g, "") + "%");
    }
    if (minScore) {
      const parsed = Number(minScore);
      if (!Number.isNaN(parsed)) {
        query = query.gte("final_score", parsed);
      }
    }
    if (maxScore) {
      const parsed = Number(maxScore);
      if (!Number.isNaN(parsed)) {
        query = query.lte("final_score", parsed);
      }
    }

    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const filtered = search
      ? data?.filter((run) =>
          [run.company, run.industry, run.interpretation]
            .filter(Boolean)
            .some((value) => value!.toLowerCase().includes(search.toLowerCase()))
        ) ?? []
      : data ?? [];

    return NextResponse.json({ leads: filtered });
  } catch (error) {
    console.error("Failed to load lead runs", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
