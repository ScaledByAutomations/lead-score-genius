import { getMapsSnapshot } from "./enrich/maps";
import type { ReviewSnapshot } from "./types";

export async function fetchGoogleMapsReviews(
  query: string,
  providedUrl?: string,
  companyName?: string
): Promise<ReviewSnapshot> {
  const snapshot = await getMapsSnapshot(query, providedUrl, companyName);
  return snapshot;
}
