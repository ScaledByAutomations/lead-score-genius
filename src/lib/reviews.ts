import { getMapsSnapshot } from "./enrich/maps";
import { scheduleMapsLookup } from "./enrich/mapsLimiter";
import type { ReviewSnapshot } from "./types";

export async function fetchGoogleMapsReviews(
  query: string,
  providedUrl?: string,
  companyName?: string
): Promise<ReviewSnapshot> {
  const normalizedQuery = query.trim();
  return scheduleMapsLookup(
    () => getMapsSnapshot(normalizedQuery, providedUrl, companyName),
    {
      query: normalizedQuery,
      cacheKey: companyName?.trim()?.toLowerCase(),
      providedUrl
    }
  );
}
