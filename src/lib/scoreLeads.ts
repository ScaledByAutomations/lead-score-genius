import { cleanLeadRecord } from "@/lib/ai/clean";
import { scoreLeadWithModel, selectWeights } from "@/lib/ai/scoring";
import { analyzeWebsite } from "@/lib/enrich/website";
import { fetchGoogleMapsReviews } from "@/lib/reviews";
import { getSupabaseAdminClient, saveLeadRunsToSupabase } from "@/lib/supabase";
import type { LeadInput, LeadScoreApiResponse } from "@/lib/types";

const DEFAULT_MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? "5");

export type ScoreLeadOptions = {
  useCleaner?: boolean;
  saveToSupabase?: boolean;
  userId?: string | null;
  maxConcurrency?: number;
  onProgress?: (payload: {
    processed: number;
    total: number;
    lead: LeadInput;
    result: LeadScoreApiResponse["leads"][number];
  }) => void;
};

export async function scoreLeads(
  leads: LeadInput[],
  options: ScoreLeadOptions = {}
): Promise<{
  leads: LeadScoreApiResponse["leads"];
  supabase?: LeadScoreApiResponse["supabase"];
}> {
  if (!Array.isArray(leads) || leads.length === 0) {
    return { leads: [], supabase: null };
  }

  const useCleaner = options.useCleaner !== false;
  const saveToSupabase = options.saveToSupabase === true;
  const maxConcurrency = options.maxConcurrency ?? DEFAULT_MAX_CONCURRENCY;

  const batches: LeadScoreApiResponse["leads"] = [];
  const orderMap = new Map(leads.map((lead, index) => [lead.lead_id, index]));

  const queue = [...leads];
  const workers: Promise<void>[] = [];

  const processLead = async (lead: LeadInput) => {
    const rawRecord = lead.normalized ?? {};

    let cleaned: Awaited<ReturnType<typeof cleanLeadRecord>> | null = null;
    let reviewSnapshot: Awaited<ReturnType<typeof fetchGoogleMapsReviews>> = {
      averageRating: null,
      reviewCount: null,
      sourceUrl: null,
      method: "not_attempted"
    };
    let websiteSignals: Awaited<ReturnType<typeof analyzeWebsite>> = null;

    try {
      cleaned = await cleanLeadRecord(rawRecord, lead.lead_id, { useAi: useCleaner });

      const queryParts = [cleaned.company, cleaned.location].filter(Boolean).join(" ");
      const companyIdentifier = cleaned.company ?? lead.company ?? "";
      const lookupQuery = queryParts || companyIdentifier || lead.company || "";

      reviewSnapshot = await fetchGoogleMapsReviews(
        lookupQuery,
        cleaned.maps_url,
        companyIdentifier || undefined
      );

      websiteSignals = await analyzeWebsite(cleaned.website ?? lead.website);

      const score = await scoreLeadWithModel(cleaned, reviewSnapshot, websiteSignals);

      const result = {
        lead,
        score,
        enriched: {
          cleaned,
          reviews: reviewSnapshot,
          website: websiteSignals
        }
      } as LeadScoreApiResponse["leads"][number];

      batches.push(result);
      options.onProgress?.({
        processed: batches.length,
        total: leads.length,
        lead,
        result
      });
    } catch (processingError) {
      console.error("Failed to score lead", { leadId: lead.lead_id }, processingError);

      const weights = selectWeights(cleaned?.industry ?? lead.industry);
      const safeCleaned =
        cleaned ?? {
          lead_id: lead.lead_id,
          company: lead.company,
          industry: lead.industry,
          website: lead.website,
          location: lead.location,
          notes: lead.notes,
          maps_url: undefined,
          years_in_business: null,
          normalized: rawRecord,
          provenance: {}
        };

      const fallbackScore: LeadScoreApiResponse["leads"][number]["score"] = {
        lead_id: lead.lead_id,
        industry: safeCleaned.industry ?? lead.industry ?? "default",
        weights_applied: weights,
        scores: {
          website_activity: 0,
          reviews: {
            average_rating: reviewSnapshot.averageRating,
            review_count: reviewSnapshot.reviewCount,
            score: 0
          },
          years_in_business: 0,
          revenue_proxies: 0,
          industry_fit: 0
        },
        reasoning:
          processingError instanceof Error
            ? `Scoring failed: ${processingError.message}`
            : `Scoring failed: ${String(processingError)}`,
        final_score: 0,
        interpretation: "Cold Dead"
      };

      const result = {
        lead,
        score: fallbackScore,
        enriched: {
          cleaned: safeCleaned,
          reviews: reviewSnapshot,
          website: websiteSignals
        }
      } as LeadScoreApiResponse["leads"][number];

      batches.push(result);
      options.onProgress?.({
        processed: batches.length,
        total: leads.length,
        lead,
        result
      });
    }
  };

  while (queue.length > 0 || workers.length > 0) {
    while (queue.length > 0 && workers.length < maxConcurrency) {
      const lead = queue.shift();
      if (!lead) {
        break;
      }
      const worker = processLead(lead).finally(() => {
        const index = workers.indexOf(worker);
        if (index >= 0) {
          workers.splice(index, 1);
        }
      });
      workers.push(worker);
    }

    if (workers.length > 0) {
      await Promise.race(workers);
    }
  }

  batches.sort((a, b) => (orderMap.get(a.lead.lead_id) ?? 0) - (orderMap.get(b.lead.lead_id) ?? 0));

  let supabaseResult: LeadScoreApiResponse["supabase"] = null;

  if (saveToSupabase) {
    try {
      const client = getSupabaseAdminClient();
      if (!client) {
        throw new Error("Supabase environment variables missing");
      }
      const result = await saveLeadRunsToSupabase(
        batches,
        client,
        options.userId ?? null
      );
      supabaseResult = { ...result, requested: true };
    } catch (supabaseError) {
      supabaseResult = {
        saved: false,
        count: 0,
        error:
          supabaseError instanceof Error
            ? supabaseError.message
            : String(supabaseError),
        requested: true
      };
    }
  }

  if (saveToSupabase && !supabaseResult) {
    supabaseResult = { saved: false, count: 0, requested: true };
  }

  return { leads: batches, supabase: supabaseResult };
}
