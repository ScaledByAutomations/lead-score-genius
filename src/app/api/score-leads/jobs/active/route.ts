import { NextResponse } from "next/server";

import { findActiveJobForUser } from "@/lib/jobQueue";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("user_id") ?? url.searchParams.get("userId");

  if (!userId) {
    return NextResponse.json({ error: "user_id is required" }, { status: 400 });
  }

  const job = await findActiveJobForUser(userId);

  return NextResponse.json({ job });
}
