import { NextResponse } from "next/server";

import type { LeadInput } from "@/lib/types";
import { enqueueLeadJob } from "@/lib/jobQueue";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const leads: LeadInput[] = Array.isArray(payload?.leads) ? payload.leads : [];

    if (leads.length === 0) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 });
    }

    const authUserId = typeof payload?.user_id === "string" && payload.user_id.trim() !== ""
      ? payload.user_id.trim()
      : null;

    const job = await enqueueLeadJob(leads, {
      useCleaner: payload?.options?.useCleaner !== false,
      saveToSupabase: payload?.options?.saveToSupabase === true,
      userId: authUserId
    });

    return NextResponse.json({ job });
  } catch (error) {
    console.error("Failed to enqueue lead scoring job", error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
