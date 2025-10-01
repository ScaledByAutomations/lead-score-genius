import { randomUUID } from "crypto";

import type { LeadInput, LeadScoreApiResponse } from "@/lib/types";
import { scoreLeads, type ScoreLeadOptions } from "@/lib/scoreLeads";

type JobStatus = "pending" | "processing" | "completed" | "failed";

type IndexedResult = {
  index: number;
  item: LeadScoreApiResponse["leads"][number];
};

type InternalJob = {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  supabase: LeadScoreApiResponse["supabase"];
  resultMap: Map<string, IndexedResult>;
  orderMap: Map<string, number>;
  leads: LeadInput[];
  options: Omit<ScoreLeadOptions, "onProgress">;
};

export type JobSnapshot = {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  supabase: LeadScoreApiResponse["supabase"];
  results: LeadScoreApiResponse["leads"];
};

const jobs = new Map<string, InternalJob>();
const queue: string[] = [];
let processing = false;

function toSnapshot(job: InternalJob): JobSnapshot {
  const results = Array.from(job.resultMap.values())
    .sort((a, b) => a.index - b.index)
    .map((entry) => entry.item);

  return {
    id: job.id,
    status: job.status,
    total: job.total,
    processed: job.processed,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    error: job.error,
    supabase: job.supabase,
    results
  };
}

async function runQueue() {
  if (processing) {
    return;
  }

  const nextId = queue.shift();
  if (!nextId) {
    return;
  }

  const job = jobs.get(nextId);
  if (!job) {
    return runQueue();
  }

  processing = true;

  try {
    job.status = "processing";
    job.updatedAt = Date.now();

    const result = await scoreLeads(job.leads, {
      ...job.options,
      onProgress: ({ lead, result }) => {
        job.processed += 1;
        job.updatedAt = Date.now();
        const index = job.orderMap.get(lead.lead_id) ?? job.resultMap.size;
        job.resultMap.set(lead.lead_id, { index, item: result });
      }
    });

    job.supabase = result.supabase ?? null;
    job.resultMap.clear();
    result.leads.forEach((item, idx) => {
      const index = job.orderMap.get(item.lead.lead_id) ?? idx;
      job.resultMap.set(item.lead.lead_id, { index, item });
    });
    job.processed = job.total;
    job.status = "completed";
    job.updatedAt = Date.now();
    job.leads = [];
  } catch (error) {
    job.status = "failed";
    job.error = error instanceof Error ? error.message : String(error);
    job.updatedAt = Date.now();
  } finally {
    processing = false;
    runQueue().catch((queueError) => {
      console.error("Job queue failed", queueError);
    });
  }
}

export function enqueueLeadJob(
  leads: LeadInput[],
  options: Omit<ScoreLeadOptions, "onProgress"> = {}
): JobSnapshot {
  const id = randomUUID();
  const now = Date.now();
  const job: InternalJob = {
    id,
    status: "pending",
    total: leads.length,
    processed: 0,
    createdAt: now,
    updatedAt: now,
    error: undefined,
    supabase: null,
    resultMap: new Map(),
    orderMap: new Map(leads.map((lead, index) => [lead.lead_id, index])),
    leads,
    options
  };

  jobs.set(id, job);
  queue.push(id);
  runQueue().catch((error) => {
    console.error("Failed to process job queue", error);
  });

  return toSnapshot(job);
}

export function getJob(jobId: string): JobSnapshot | null {
  const job = jobs.get(jobId);
  if (!job) {
    return null;
  }
  return toSnapshot(job);
}

export function listJobs(): JobSnapshot[] {
  return Array.from(jobs.values()).map(toSnapshot);
}
