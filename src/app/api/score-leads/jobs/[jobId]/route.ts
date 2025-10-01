import { NextResponse } from "next/server";

import { getJob } from "@/lib/jobQueue";

type Context = {
  params: {
    jobId: string;
  };
};

export async function GET(_request: Request, context: Context) {
  const jobId = context.params.jobId;
  const job = jobId ? getJob(jobId) : null;

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  return NextResponse.json({ job });
}
