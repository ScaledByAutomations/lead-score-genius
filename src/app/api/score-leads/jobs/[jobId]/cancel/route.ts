import { NextResponse } from "next/server";

import { cancelJob } from "@/lib/jobQueue";

type Context = {
  params: {
    jobId: string;
  };
};

export async function POST(
  request: Request,
  { params }: { params: Promise<Context["params"]> }
) {
  const { jobId } = await params;

  if (!jobId) {
    return NextResponse.json({ error: "Job ID is required" }, { status: 400 });
  }

  let reason: string | undefined;
  try {
    const payload = await request.json();
    if (typeof payload?.reason === "string") {
      reason = payload.reason;
    }
  } catch {
    // Ignore invalid or empty bodies.
  }

  try {
    const snapshot = await cancelJob(jobId, reason);
    if (!snapshot) {
      return NextResponse.json({ error: "Job not found" }, { status: 404 });
    }

    return NextResponse.json({ job: snapshot });
  } catch (error) {
    console.error("Failed to cancel lead job", { jobId }, error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<Context["params"]> }
) {
  return POST(request, context);
}
