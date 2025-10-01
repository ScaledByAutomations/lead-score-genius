import { NextResponse } from "next/server";

import { fetchGoogleMapsReviews } from "@/lib/reviews";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const query = searchParams.get("query");
  const url = searchParams.get("url") ?? undefined;
  const company = searchParams.get("company") ?? undefined;

  if (!query && !url) {
    return NextResponse.json({ error: "Provide query or url" }, { status: 400 });
  }

  const lookupQuery = query ?? "";

  try {
    const snapshot = await fetchGoogleMapsReviews(lookupQuery, url, company ?? query ?? undefined);
    return NextResponse.json({
      query: lookupQuery,
      snapshot
    });
  } catch (error) {
    return NextResponse.json({ error: (error as Error).message }, { status: 500 });
  }
}
