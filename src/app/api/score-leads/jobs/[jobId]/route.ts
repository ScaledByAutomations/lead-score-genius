import { NextResponse, after } from "next/server";

import { getJob, triggerLeadJob } from "@/lib/jobQueue";

type Context = {
  params: {
    jobId: string;
  };
};

export async function GET(
  _request: Request,
  { params }: { params: Promise<Context["params"]> }
) {
  const { jobId } = await params;
  const job = jobId ? await getJob(jobId) : null;

  if (!job) {
    return NextResponse.json({ error: "Job not found" }, { status: 404 });
  }

  if (job.status !== "completed" && job.status !== "failed" && job.processed < job.total) {
    after(() => triggerLeadJob(job.id));
  }

  return NextResponse.json({ job });
}
