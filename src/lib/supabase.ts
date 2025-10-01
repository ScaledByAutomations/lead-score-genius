import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { LeadScoreApiResponse, SupabaseSaveResult } from "./types";
import { getEnv } from "./env";

let cachedAdminClient: SupabaseClient | null = null;

export function getSupabaseAdminClient(): SupabaseClient | null {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = getEnv();

  if (!NEXT_PUBLIC_SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    return null;
  }

  if (!cachedAdminClient) {
    cachedAdminClient = createClient(NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: {
        persistSession: false
      }
    });
  }

  return cachedAdminClient;
}

export async function saveLeadRunsToSupabase(
  leads: LeadScoreApiResponse["leads"],
  clientOverride?: SupabaseClient | null,
  userId?: string | null
): Promise<SupabaseSaveResult> {
  const client = clientOverride ?? getSupabaseAdminClient();
  if (!client) {
    return { saved: false, count: 0, error: "Supabase environment variables missing" };
  }

  if (!Array.isArray(leads) || leads.length === 0) {
    return { saved: false, count: 0, error: "No leads provided" };
  }

  const rows = leads.map(({ lead, score, enriched }) => ({
    user_id: userId ?? null,
    lead_id: lead.lead_id,
    company: lead.company,
    industry: score.industry,
    final_score: score.final_score,
    interpretation: score.interpretation,
    weights: score.weights_applied,
    scores: score.scores,
    reasoning: score.reasoning,
    enriched,
    created_at: new Date().toISOString()
  }));

  const { error } = await client.from("lead_runs").insert(rows);
  if (error) {
    return { saved: false, count: 0, error: error.message };
  }

  return { saved: true, count: rows.length };
}
