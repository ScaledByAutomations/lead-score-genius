import { cleanLeadRecord } from "@/lib/ai/clean";
import { scoreLeadWithModel, selectWeights } from "@/lib/ai/scoring";
import { analyzeWebsite } from "@/lib/enrich/website";
import { fetchGoogleMapsReviews } from "@/lib/reviews";
import { getSupabaseAdminClient, saveLeadRunsToSupabase } from "@/lib/supabase";
import type { LeadInput, LeadScoreApiResponse } from "@/lib/types";

const DEFAULT_MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? "5");

const normalizeKey = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }
  return trimmed.replace(/\s+/g, " ");
};

const normalizeUrlKey = (value?: string | null) => {
  if (!value) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  try {
    const url = new URL(trimmed);
    url.hash = "";
    const paramsToStrip = ["authuser", "hl", "entry", "sa", "ved", "ei", "source"];
    for (const param of paramsToStrip) {
      url.searchParams.delete(param);
    }
    url.searchParams.sort();
    return url.toString();
  } catch {
    return trimmed;
  }
};

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
  }) => void | Promise<void>;
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
  const reviewPromiseCache = new Map<string, Promise<Awaited<ReturnType<typeof fetchGoogleMapsReviews>>>>();

  const queue = [...leads];
  const workers: Promise<void>[] = [];

  const processLead = async (lead: LeadInput) => {
    const rawRecord = lead.normalized ?? {};
    const startedAt = Date.now();
    let cleanDuration = 0;
    let reviewDuration = 0;
    let websiteDuration = 0;
    let scoreDuration = 0;
    let reviewCacheHitKey: string | null = null;
    let status: "success" | "error" = "success";
    let reviewStart = 0;
    let websiteStart = 0;
    let scoreStart = 0;

    let cleaned: Awaited<ReturnType<typeof cleanLeadRecord>> | null = null;
    let reviewSnapshot: Awaited<ReturnType<typeof fetchGoogleMapsReviews>> = {
      averageRating: null,
      reviewCount: null,
      sourceUrl: null,
      method: "not_attempted"
    };
    let websiteSignals: Awaited<ReturnType<typeof analyzeWebsite>> = null;
    let reviewPromise: Promise<Awaited<ReturnType<typeof fetchGoogleMapsReviews>>> | null = null;
    let websitePromise: Promise<Awaited<ReturnType<typeof analyzeWebsite>>> | null = null;

    try {
      const cleanStart = Date.now();
      cleaned = await cleanLeadRecord(rawRecord, lead.lead_id, { useAi: useCleaner });
      cleanDuration = Date.now() - cleanStart;

      const queryParts = [cleaned.company, cleaned.location].filter(Boolean).join(" ");
      const companyIdentifier = cleaned.company ?? lead.company ?? "";
      const lookupQuery = queryParts || companyIdentifier || lead.company || "";

      const reviewCacheKeys = new Set<string>();
      const normalizedCompany = normalizeKey(companyIdentifier || lead.company || null);
      const normalizedQuery = normalizeKey(lookupQuery);
      const normalizedMapsUrl = normalizeUrlKey(cleaned.maps_url ?? undefined);

      if (normalizedMapsUrl) {
        reviewCacheKeys.add(`maps:${normalizedMapsUrl}`);
      }
      if (normalizedCompany) {
        reviewCacheKeys.add(`company:${normalizedCompany}`);
      }
      if (normalizedQuery) {
        reviewCacheKeys.add(`query:${normalizedQuery}`);
      }

      for (const key of reviewCacheKeys) {
        const existing = reviewPromiseCache.get(key);
        if (existing) {
          reviewPromise = existing;
          reviewCacheHitKey = key;
          console.debug("reuse cached review snapshot", { leadId: lead.lead_id, cacheKey: key });
          break;
        }
      }

      websiteStart = Date.now();
      websitePromise = analyzeWebsite(cleaned.website ?? lead.website);

      if (!reviewPromise) {
        if (reviewCacheKeys.size > 0) {
          console.debug("fetching fresh review snapshot", {
            leadId: lead.lead_id,
            cacheKeys: Array.from(reviewCacheKeys)
          });
        }
        reviewPromise = fetchGoogleMapsReviews(
          lookupQuery,
          cleaned.maps_url,
          companyIdentifier || undefined
        );
        const keyList = Array.from(reviewCacheKeys);
        if (keyList.length > 0) {
          for (const key of keyList) {
            reviewPromiseCache.set(key, reviewPromise);
          }
          reviewPromise.catch(() => {
            for (const key of keyList) {
              const stored = reviewPromiseCache.get(key);
              if (stored === reviewPromise) {
                reviewPromiseCache.delete(key);
              }
            }
          });
        }
      }

      if (!reviewPromise) {
        throw new Error("Review lookup initialization failed");
      }

      reviewStart = Date.now();
      reviewSnapshot = await reviewPromise;
      reviewDuration = Date.now() - reviewStart;

      if (reviewSnapshot.averageRating === null && reviewSnapshot.reviewCount === null) {
        const keyList = Array.from(reviewCacheKeys);
        for (const key of keyList) {
          const stored = reviewPromiseCache.get(key);
          if (stored === reviewPromise) {
            reviewPromiseCache.delete(key);
          }
        }
      }

      if (websitePromise) {
        const websiteResult = await websitePromise;
        websiteDuration = Date.now() - websiteStart;
        websiteSignals = websiteResult;
      }

      scoreStart = Date.now();
      const score = await scoreLeadWithModel(cleaned, reviewSnapshot, websiteSignals);
      scoreDuration = Date.now() - scoreStart;

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
      if (options.onProgress) {
        await options.onProgress({
          processed: batches.length,
          total: leads.length,
          lead,
          result
        });
      }
    } catch (processingError) {
      status = "error";
      if (websitePromise) {
        try {
          const websiteResult = await websitePromise;
          websiteSignals = websiteResult;
          if (websiteDuration === 0 && websiteStart > 0) {
            websiteDuration = Date.now() - websiteStart;
          }
        } catch {
          if (websiteDuration === 0 && websiteStart > 0) {
            websiteDuration = Date.now() - websiteStart;
          }
        }
      }
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
      if (options.onProgress) {
        await options.onProgress({
          processed: batches.length,
          total: leads.length,
          lead,
          result
        });
      }
    } finally {
      const totalDuration = Date.now() - startedAt;
      console.info("lead processing timing", {
        leadId: lead.lead_id,
        status,
        durations_ms: {
          total: totalDuration,
          clean: cleanDuration,
          reviews: reviewDuration,
          website: websiteDuration,
          score: scoreDuration
        },
        review_method: reviewSnapshot.method,
        review_cache_key: reviewCacheHitKey
      });
      if (reviewSnapshot.method === "not_found") {
        const companyKey = normalizeKey(lead.company);
        if (companyKey) {
          reviewPromiseCache.delete(`company:${companyKey}`);
        }
      }
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
