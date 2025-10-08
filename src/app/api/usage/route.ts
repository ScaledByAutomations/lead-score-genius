import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase";

type UsageResponse = {
  usageByDay: Array<{ date: string; cleaning: number; scoring: number }>;
  jobs: Array<{
    id: string;
    status: string;
    total: number;
    processed: number;
    createdAt: number;
    updatedAt: number;
    tokens: { cleaning: number; scoring: number; total: number };
    userId: string | null;
  }>;
  totals: {
    cleaning: number;
    scoring: number;
  };
};

const toISODate = (value: Date) => value.toISOString();

export async function GET(request: Request) {
  const client = getSupabaseAdminClient();
  if (!client) {
    return NextResponse.json({ error: "Supabase not configured" }, { status: 500 });
  }

  const url = new URL(request.url);
  const startParam = url.searchParams.get("start");
  const endParam = url.searchParams.get("end");
  const statusParam = url.searchParams.get("status");
  const userIdParam = url.searchParams.get("user_id") ?? url.searchParams.get("userId");
  const userId = userIdParam && userIdParam.trim() !== "" ? userIdParam.trim() : null;

  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const endDate = endParam ? new Date(endParam) : new Date();
  const startDate = startParam ? new Date(startParam) : new Date(endDate.getTime() - 7 * 24 * 60 * 60 * 1000);

  const startIso = toISODate(new Date(startDate.setHours(0, 0, 0, 0)));
  const endIso = toISODate(new Date(endDate.setHours(23, 59, 59, 999)));

  const usageQuery = client
    .from("lead_token_usage")
    .select("created_at, category, total_tokens")
    .gte("created_at", startIso)
    .lte("created_at", endIso)
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  const { data: usageRows, error: usageError } = await usageQuery;
  if (usageError) {
    return NextResponse.json({ error: usageError.message }, { status: 500 });
  }

  const usageByDayMap = new Map<string, { cleaning: number; scoring: number }>();
  const totals = { cleaning: 0, scoring: 0 };

  (usageRows ?? []).forEach((row) => {
    const created = row.created_at ? new Date(row.created_at) : null;
    if (!created || Number.isNaN(created.getTime())) {
      return;
    }
    const dateKey = created.toISOString().slice(0, 10);
    if (!usageByDayMap.has(dateKey)) {
      usageByDayMap.set(dateKey, { cleaning: 0, scoring: 0 });
    }
    const bucket = usageByDayMap.get(dateKey)!;
    const tokens = Number(row.total_tokens ?? 0);
    if (row.category === "clean") {
      bucket.cleaning += tokens;
      totals.cleaning += tokens;
    } else {
      bucket.scoring += tokens;
      totals.scoring += tokens;
    }
  });

  const usageByDay = Array.from(usageByDayMap.entries())
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, value]) => ({ date, cleaning: value.cleaning, scoring: value.scoring }));

  let jobQuery = client
    .from("lead_jobs")
    .select("id, status, total, processed, created_at, updated_at, user_id, metadata")
    .order("created_at", { ascending: false })
    .limit(100)
    .eq("user_id", userId);

  if (statusParam) {
    jobQuery = jobQuery.eq("status", statusParam);
  }

  const { data: jobRows, error: jobError } = await jobQuery;
  if (jobError) {
    return NextResponse.json({ error: jobError.message }, { status: 500 });
  }

  const jobs = (jobRows ?? []).map((job) => {
    const metadataUsage = job.metadata?.usage ?? null;
    const cleaning = metadataUsage?.cleaning?.totalTokens ?? 0;
    const scoring = metadataUsage?.scoring?.totalTokens ?? 0;
    return {
      id: job.id,
      status: job.status,
      total: job.total,
      processed: job.processed,
      createdAt: new Date(job.created_at).getTime(),
      updatedAt: new Date(job.updated_at).getTime(),
      tokens: {
        cleaning,
        scoring,
        total: cleaning + scoring
      },
      userId: job.user_id ?? null
    };
  });

  const payload: UsageResponse = {
    usageByDay,
    jobs,
    totals
  };

  return NextResponse.json(payload);
}
