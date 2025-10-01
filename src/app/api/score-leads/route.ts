import { NextResponse } from "next/server";

import type { LeadInput } from "@/lib/types";
import { scoreLeads } from "@/lib/scoreLeads";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const leads: LeadInput[] = Array.isArray(payload?.leads) ? payload.leads : [];
    const options = payload?.options ?? {};

    if (leads.length === 0) {
      return NextResponse.json({ error: "No leads provided" }, { status: 400 });
    }

    const authUserId = typeof payload?.user_id === "string" && payload.user_id.trim() !== ""
      ? payload.user_id.trim()
      : null;

    const result = await scoreLeads(leads, {
      useCleaner: options.useCleaner !== false,
      saveToSupabase: options?.saveToSupabase === true,
      userId: authUserId
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
