export type LeadInput = {
  lead_id: string;
  company: string;
  industry?: string;
  location?: string;
  website?: string;
  notes?: string;
  normalized?: Record<string, string>;
};

export type ReviewSnapshot = {
  averageRating: number | null;
  reviewCount: number | null;
  sourceUrl: string | null;
  method?: string;
};

export type SupabaseSaveResult = {
  saved: boolean;
  count: number;
  error?: string;
};

export type TokenUsageTotals = {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
};

export type TokenUsageSummary = {
  cleaning: TokenUsageTotals;
  scoring: TokenUsageTotals;
};

export type LeadScoreResponse = {
  lead_id: string;
  industry: string;
  weights_applied: {
    website_activity: number;
    reviews: number;
    years_in_business: number;
    revenue_proxies: number;
    industry_fit: number;
  };
  scores: {
    website_activity: number;
    reviews: {
      average_rating: number | null;
      review_count: number | null;
      score: number;
    };
    years_in_business: number;
    revenue_proxies: number;
    industry_fit: number;
  };
  reasoning: string;
  final_score: number;
  interpretation: "Cold Dead" | "Borderline" | "Qualified" | "Hot";
};

export type LeadScoreApiResponse = {
  leads: Array<{
    lead: LeadInput;
    score: LeadScoreResponse;
    enriched: {
      cleaned: import("./ai/clean").CleanLead;
      reviews: ReviewSnapshot;
      website: import("./enrich/website").WebsiteSignals | null;
    };
  }>;
  supabase?: (SupabaseSaveResult & { requested: boolean }) | null;
  usage?: TokenUsageSummary;
};
