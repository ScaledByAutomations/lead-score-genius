
import type { SupabaseClient } from "@supabase/supabase-js";

import type { LeadInput, LeadScoreApiResponse } from "@/lib/types";
import { getSupabaseAdminClient } from "@/lib/supabase";
import { scoreLeads, type ScoreLeadOptions } from "@/lib/scoreLeads";

const STALE_JOB_THRESHOLD_MS = Number(process.env.LEAD_JOB_STALE_MS ?? "60000");

type JobStatus = "pending" | "processing" | "completed" | "failed";

type JobMetadata = {
  options?: {
    useCleaner: boolean;
    saveToSupabase: boolean;
    maxConcurrency?: number;
  };
  supabase?: LeadScoreApiResponse["supabase"];
};

type LeadJobRow = {
  id: string;
  user_id: string | null;
  status: string;
  total: number;
  processed: number;
  error: string | null;
  metadata: JobMetadata | null;
  created_at: string;
  updated_at: string;
};

type LeadJobItemRow = {
  job_id: string;
  item_index: number;
  payload: LeadInput;
  status: string;
  error: string | null;
  result: LeadScoreApiResponse["leads"][number] | null;
  processed_at: string | null;
  created_at: string;
  updated_at: string;
};

function isJobStale(job: LeadJobRow): boolean {
  const updatedAt = new Date(job.updated_at).getTime();
  return Number.isFinite(updatedAt) && Date.now() - updatedAt > STALE_JOB_THRESHOLD_MS;
}

async function claimLeadJob(
  client: SupabaseClient,
  job: LeadJobRow
): Promise<{ job: LeadJobRow; items: LeadJobItemRow[] } | null> {
  if (job.status === "completed" || job.status === "failed") {
    return null;
  }

  if (job.status === "queued") {
    const { data: claimed, error: claimError } = await client
      .from("lead_jobs")
      .update({ status: "processing" })
      .eq("id", job.id)
      .eq("status", "queued")
      .select("*")
      .maybeSingle<LeadJobRow>();

    if (claimError) {
      console.error("Failed to claim queued job", { jobId: job.id }, claimError);
      return null;
    }

    if (!claimed) {
      return null;
    }

    const refreshed = await loadJob(client, job.id);
    return refreshed;
  }

  if (job.status === "processing") {
    if (!isJobStale(job)) {
      return null;
    }

    const staleCutoff = new Date(Date.now() - STALE_JOB_THRESHOLD_MS).toISOString();
    const { data: reclaimed, error: reclaimError } = await client
      .from("lead_jobs")
      .update({ status: "processing", updated_at: new Date().toISOString() })
      .eq("id", job.id)
      .eq("status", "processing")
      .lte("updated_at", staleCutoff)
      .select("*")
      .maybeSingle<LeadJobRow>();

    if (reclaimError) {
      console.error("Failed to reclaim stale job", { jobId: job.id }, reclaimError);
      return null;
    }

    if (!reclaimed) {
      return null;
    }

    const refreshed = await loadJob(client, job.id);
    return refreshed;
  }

  return null;
}

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

function mapStatus(status: string): JobStatus {
  switch (status) {
    case "queued":
      return "pending";
    case "processing":
      return "processing";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

function toSnapshot(job: LeadJobRow, items: LeadJobItemRow[]): JobSnapshot {
  const results = items
    .filter((item) => item.result)
    .sort((a, b) => a.item_index - b.item_index)
    .map((item) => item.result as LeadScoreApiResponse["leads"][number]);

  const supabaseResult = (job.metadata?.supabase ?? null) as JobSnapshot["supabase"];

  return {
    id: job.id,
    status: mapStatus(job.status),
    total: job.total,
    processed: job.processed,
    createdAt: new Date(job.created_at).getTime(),
    updatedAt: new Date(job.updated_at).getTime(),
    error: job.error ?? undefined,
    supabase: supabaseResult,
    results
  };
}

async function loadJob(
  client: SupabaseClient,
  jobId: string
): Promise<{ job: LeadJobRow; items: LeadJobItemRow[] } | null> {
  const { data: job, error: jobError } = await client
    .from("lead_jobs")
    .select("*")
    .eq("id", jobId)
    .maybeSingle<LeadJobRow>();

  if (jobError) {
    console.error("Failed to load job", { jobId }, jobError);
    return null;
  }

  if (!job) {
    return null;
  }

  const { data: items, error: itemsError } = await client
    .from("lead_job_items")
    .select("*")
    .eq("job_id", jobId)
    .order("item_index", { ascending: true })
    .returns<LeadJobItemRow[]>();

  if (itemsError) {
    console.error("Failed to load job items", { jobId }, itemsError);
    return null;
  }

  return { job, items: items ?? [] };
}

async function processLeadJob(jobId: string) {
  const client = getSupabaseAdminClient();
  if (!client) {
    console.error("Supabase client not configured; cannot process job", { jobId });
    return;
  }

  const payload = await loadJob(client, jobId);
  if (!payload) {
    return;
  }

  let { job, items } = payload;

  const claimed = await claimLeadJob(client, job);
  if (!claimed) {
    return;
  }

  ({ job, items } = claimed);

  const pendingItems = items.filter((item) => !item.result);

  if (pendingItems.length === 0) {
    const metadata = { ...(job.metadata ?? {}) } as JobMetadata;
    const processedComplete = items.length;
    const { error: completeError } = await client
      .from("lead_jobs")
      .update({ status: "completed", processed: processedComplete, metadata })
      .eq("id", jobId);

    if (completeError) {
      console.error("Failed to finalize job", { jobId }, completeError);
    }

    return;
  }

  const processedSet = items.filter((item) => item.result).length;
  let processedCount = Math.max(job.processed ?? 0, processedSet);

  const indexQueues = new Map<string, number[]>();
  const itemsByIndex = new Map<number, LeadJobItemRow>();

  for (const item of items) {
    itemsByIndex.set(item.item_index, item);
    if (!item.result) {
      const key = item.payload.lead_id;
      const queue = indexQueues.get(key) ?? [];
      queue.push(item.item_index);
      indexQueues.set(key, queue);
    }
  }

  const metadata = { ...(job.metadata ?? {}) } as JobMetadata;
  const options = metadata.options ?? {
    useCleaner: true,
    saveToSupabase: false
  };

  const leadsToProcess = pendingItems.map((item) => item.payload);

  try {
    const result = await scoreLeads(leadsToProcess, {
      useCleaner: options.useCleaner,
      saveToSupabase: options.saveToSupabase,
      userId: job.user_id,
      maxConcurrency: options.maxConcurrency,
      onProgress: async ({ lead, result: leadResult }) => {
        const queue = indexQueues.get(lead.lead_id);
        const itemIndex = queue?.shift();
        if (queue && queue.length === 0) {
          indexQueues.delete(lead.lead_id);
        }

        if (itemIndex === undefined) {
          console.warn("No job item index found for lead", { jobId, leadId: lead.lead_id });
          return;
        }

        const now = new Date().toISOString();
        const sanitizedResult = {
          ...leadResult,
          lead: { ...leadResult.lead }
        } as LeadScoreApiResponse["leads"][number];

        const { error: itemError } = await client
          .from("lead_job_items")
          .update({
            status: "completed",
            result: sanitizedResult,
            error: null,
            processed_at: now
          })
          .eq("job_id", jobId)
          .eq("item_index", itemIndex);

        if (itemError) {
          console.error("Failed to update job item", { jobId, itemIndex }, itemError);
        }

        processedCount += 1;

        const { error: progressError } = await client
          .from("lead_jobs")
          .update({ processed: processedCount })
          .eq("id", jobId);

        if (progressError) {
          console.error("Failed to update job progress", { jobId }, progressError);
        }

        const currentItem = itemsByIndex.get(itemIndex);
        if (currentItem) {
          currentItem.status = "completed";
          currentItem.result = sanitizedResult;
          currentItem.error = null;
          currentItem.processed_at = now;
        }
      }
    });

    metadata.options = {
      useCleaner: options.useCleaner,
      saveToSupabase: options.saveToSupabase,
      maxConcurrency: options.maxConcurrency
    };
    metadata.supabase = result.supabase ?? null;

    const { error: completeError } = await client
      .from("lead_jobs")
      .update({
        status: "completed",
        processed: itemsByIndex.size,
        error: null,
        metadata
      })
      .eq("id", jobId);

    if (completeError) {
      console.error("Failed to mark job completed", { jobId }, completeError);
    }
  } catch (error) {
    console.error("Lead job processing failed", { jobId }, error);

    const errorMessage = error instanceof Error ? error.message : String(error);
    const { error: jobError } = await client
      .from("lead_jobs")
      .update({ status: "failed", error: errorMessage, processed: processedCount })
      .eq("id", jobId);

    if (jobError) {
      console.error("Failed to mark job failed", { jobId }, jobError);
    }

    const { error: remainingError } = await client
      .from("lead_job_items")
      .update({ status: "failed", error: errorMessage })
      .eq("job_id", jobId)
      .in("status", ["queued", "processing"]);

    if (remainingError) {
      console.error("Failed to update remaining job items", { jobId }, remainingError);
    }
  }
}

export async function enqueueLeadJob(
  leads: LeadInput[],
  options: Omit<ScoreLeadOptions, "onProgress"> = {}
): Promise<JobSnapshot> {
  const client = getSupabaseAdminClient();
  if (!client) {
    throw new Error("Supabase client not configured");
  }

  const metadata: JobMetadata = {
    options: {
      useCleaner: options.useCleaner !== false,
      saveToSupabase: options.saveToSupabase === true,
      maxConcurrency: options.maxConcurrency
    }
  };

  const { data: job, error: jobError } = await client
    .from("lead_jobs")
    .insert({
      user_id: options.userId ?? null,
      status: "queued",
      total: leads.length,
      processed: 0,
      metadata
    })
    .select("*")
    .single<LeadJobRow>();

  if (jobError || !job) {
    console.error("Failed to enqueue lead job", jobError);
    throw new Error(jobError?.message ?? "Failed to enqueue job");
  }

  const items = leads.map((lead, index) => ({
    job_id: job.id,
    item_index: index,
    payload: lead,
    status: "queued"
  }));

  const { error: itemsError } = await client.from("lead_job_items").insert(items);
  if (itemsError) {
    console.error("Failed to insert lead job items", { jobId: job.id }, itemsError);
    throw new Error(itemsError.message ?? "Failed to store job items");
  }

  const snapshot = await getJob(job.id);
  if (!snapshot) {
    throw new Error("Failed to retrieve job after enqueueing");
  }
  return snapshot;
}

export async function getJob(jobId: string): Promise<JobSnapshot | null> {
  const client = getSupabaseAdminClient();
  if (!client) {
    console.error("Supabase client not configured");
    return null;
  }

  const payload = await loadJob(client, jobId);
  if (!payload) {
    return null;
  }

  return toSnapshot(payload.job, payload.items);
}

export async function listJobs(): Promise<JobSnapshot[]> {
  const client = getSupabaseAdminClient();
  if (!client) {
    console.error("Supabase client not configured");
    return [];
  }

  const { data: jobs, error } = await client
    .from("lead_jobs")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !jobs) {
    if (error) {
      console.error("Failed to list jobs", error);
    }
    return [];
  }

  const snapshots: JobSnapshot[] = [];
  for (const job of jobs) {
    const payload = await loadJob(client, job.id);
    if (payload) {
      snapshots.push(toSnapshot(payload.job, payload.items));
    }
  }

  return snapshots;
}

export function triggerLeadJob(jobId: string) {
  processLeadJob(jobId).catch((error) => {
    console.error("Background lead job failed", { jobId }, error);
  });
}
