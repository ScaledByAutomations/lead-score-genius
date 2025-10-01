import { callOpenRouter } from "../openrouter";
import type { CleanLead } from "./clean";
import type { ReviewSnapshot } from "../types";
import type { WebsiteSignals } from "../enrich/website";
import type { LeadScoreResponse } from "../types";

export type WeightSet = {
  website_activity: number;
  reviews: number;
  years_in_business: number;
  revenue_proxies: number;
  industry_fit: number;
};

const INDUSTRY_WEIGHTS: Record<string, WeightSet> = {
  real_estate: {
    website_activity: 0.3,
    reviews: 0.3,
    years_in_business: 0.15,
    revenue_proxies: 0.15,
    industry_fit: 0.1
  },
  marketing_agency: {
    website_activity: 0.35,
    reviews: 0.2,
    years_in_business: 0.15,
    revenue_proxies: 0.25,
    industry_fit: 0.05
  },
  local_services: {
    website_activity: 0.2,
    reviews: 0.35,
    years_in_business: 0.25,
    revenue_proxies: 0.15,
    industry_fit: 0.05
  },
  financial_services: {
    website_activity: 0.25,
    reviews: 0.3,
    years_in_business: 0.3,
    revenue_proxies: 0.1,
    industry_fit: 0.05
  },
  default: {
    website_activity: 0.25,
    reviews: 0.25,
    years_in_business: 0.2,
    revenue_proxies: 0.2,
    industry_fit: 0.1
  }
};

export function selectWeights(industry?: string): WeightSet {
  if (!industry) {
    return INDUSTRY_WEIGHTS.default;
  }

  const normalized = industry.trim().toLowerCase();
  if (normalized.includes("real estate")) {
    return INDUSTRY_WEIGHTS.real_estate;
  }
  if (normalized.includes("agency") || normalized.includes("marketing")) {
    return INDUSTRY_WEIGHTS.marketing_agency;
  }
  if (normalized.includes("plumb") || normalized.includes("repair") || normalized.includes("service")) {
    return INDUSTRY_WEIGHTS.local_services;
  }
  if (normalized.includes("financial") || normalized.includes("insurance") || normalized.includes("advis")) {
    return INDUSTRY_WEIGHTS.financial_services;
  }
  return INDUSTRY_WEIGHTS.default;
}

function clampScore(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.min(Math.max(Math.round(value), 0), 10);
}

function formatReasoning(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }

  if (value === null || value === undefined) {
    return "No reasoning returned";
  }

  if (Array.isArray(value)) {
    return value
      .map((item) => formatReasoning(item))
      .join("\n");
  }

  if (typeof value === "object") {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      // fall through to string conversion if serialization fails
    }
  }

  return String(value);
}

function computeDeterministicReviewScore(reviews: ReviewSnapshot): number {
  const rating = reviews.averageRating ?? 0;
  const count = reviews.reviewCount ?? 0;

  const ratingScore = rating >= 4 ? 10 : rating >= 3 ? 5 : rating > 0 ? 0 : 0;
  const countScore = count >= 50 ? 10 : count >= 10 ? 5 : count > 0 ? 2 : 0;

  const average = (ratingScore + countScore) / 2;
  return clampScore(average);
}

export function computeFinalScore(scores: LeadScoreResponse["scores"], weights: WeightSet): number {
  const weighted =
    scores.website_activity * weights.website_activity +
    scores.reviews.score * weights.reviews +
    scores.years_in_business * weights.years_in_business +
    scores.revenue_proxies * weights.revenue_proxies +
    scores.industry_fit * weights.industry_fit;

  return Number(weighted.toFixed(2));
}

export function interpretScore(score: number): LeadScoreResponse["interpretation"] {
  if (score >= 8) {
    return "Hot";
  }
  if (score >= 6) {
    return "Qualified";
  }
  if (score >= 4) {
    return "Borderline";
  }
  return "Cold Dead";
}

export async function scoreLeadWithModel(
  lead: CleanLead,
  reviews: ReviewSnapshot,
  website: WebsiteSignals | null
): Promise<LeadScoreResponse> {
  const weights = selectWeights(lead.industry);

  const messages = [
    {
      role: "system" as const,
      content: `You are an AI lead scoring engine. Produce JSON only. Adhere strictly to the scoring matrix.
Return an object with keys lead_id, industry, weights_applied, scores, reasoning, final_score, interpretation.
All factor scores must be integers 0-10. Provide detailed reasoning citing evidence provided.
Do NOT perform weighted arithmetic; the caller will recompute final scores.
If data is missing, set score to 0 and explain.
`
    },
    {
      role: "user" as const,
      content: JSON.stringify({
        lead,
        reviews,
        website,
        weights,
        guidance: {
          website_activity: "Use website.finalScore when provided. Mention method and bonuses in reasoning.",
          reviews: "Use provided rating/review count. If null, score 0 and explain scraping attempts.",
          years_in_business: "Map years_in_business to 10/>5, 5/2-4, 2/<1", 
          revenue_proxies: "Estimate from pricing signals, review volume, industry context.",
          industry_fit: "Apply core alignment and bonus rules; note any patriotic/outdoor cues if present."
        }
      })
    }
  ];

  const raw = (await callOpenRouter(messages)) as LeadScoreResponse;

  const deterministicReviewScore = computeDeterministicReviewScore(reviews);
  const modelReviewScore = clampScore(raw.scores?.reviews?.score ?? deterministicReviewScore);

  const sanitized: LeadScoreResponse = {
    ...raw,
    lead_id: raw.lead_id ?? lead.lead_id,
    industry: raw.industry ?? (lead.industry ?? "default"),
    weights_applied: weights,
    scores: {
      website_activity: clampScore(raw.scores?.website_activity ?? (website?.finalScore ?? 0)),
      reviews: {
        average_rating: reviews.averageRating,
        review_count: reviews.reviewCount,
        score: deterministicReviewScore
      },
      years_in_business: clampScore(raw.scores?.years_in_business ?? 0),
      revenue_proxies: clampScore(raw.scores?.revenue_proxies ?? 0),
      industry_fit: clampScore(raw.scores?.industry_fit ?? 0)
    },
    reasoning: formatReasoning(raw.reasoning),
    final_score: 0,
    interpretation: "Cold Dead"
  };

  const finalScore = computeFinalScore(sanitized.scores, weights);
  const interpretation = interpretScore(finalScore);

  sanitized.final_score = finalScore;
  sanitized.interpretation = interpretation;

  if (modelReviewScore !== deterministicReviewScore) {
    sanitized.reasoning += `\n[System] Reviews score adjusted to ${deterministicReviewScore} (model proposed ${modelReviewScore}).`;
  }
  if (Math.abs((raw.final_score ?? 0) - finalScore) > 0.05) {
    sanitized.reasoning += `\n[System] Final score recomputed to ${finalScore} based on weighted sum.`;
  }

  return sanitized;
}
