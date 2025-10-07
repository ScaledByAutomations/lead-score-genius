import { getEnv } from "../env";
import type { ReviewSnapshot } from "../types";
import { resolveWithHeadless } from "./mapsHeadless";
import {
  extractPlaceUrlFromHtml,
  fetchPlaceHtml,
  fetchSearchHtml,
  fetchWithTimeout,
  followRedirect,
  resolveViaApiQuery
} from "./mapsResolve";

const cache = new Map<string, { snapshot: ReviewSnapshot & { method: string }; expiresAt: number }>();
const CACHE_VERSION = "identity_v2";
const MAX_REVIEW_COUNT = 100000;
const TEXT_PATTERN = /([0-9](?:\.[0-9]+)?)\s*(?:★|stars?)?\s*\(([0-9,]+)\)/gi;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";
const GENERIC_TOKENS = new Set([
  "inc",
  "inc.",
  "llc",
  "llc.",
  "co",
  "co.",
  "corp",
  "corporation",
  "company",
  "companies",
  "group",
  "associates",
  "assoc",
  "association",
  "enterprise",
  "enterprises",
  "ltd",
  "ltd.",
  "limited",
  "pc",
  "plc",
  "pllc",
  "llp",
  "and",
  "for",
  "with",
  "the",
  "of",
  "in",
  "near",
  "at",
  "to",
  "by",
  "on",
  "a",
  "an",
  "amp",
  "system"
]);

function tokenizeQuery(query: string): string[] {
  const normalized = query.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const rawTokens = normalized.replace(/[^a-z0-9]+/g, " ").split(" ");

  const baseTokens = rawTokens
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !GENERIC_TOKENS.has(token));

  let filtered = baseTokens.filter((token) => token.length >= 3 && !/^[0-9]+$/.test(token));
  if (filtered.length === 0) {
    filtered = baseTokens.filter((token) => token.length >= 2 && !/^[0-9]+$/.test(token));
  }

  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const token of filtered) {
    if (!seen.has(token)) {
      seen.add(token);
      ordered.push(token);
    }
  }
  return ordered;
}

// Jina fallback now applies lightweight token matching to guard against mismatched listings.

function deriveIdentityTokens(value?: string | null): { tokens: string[]; strongTokens: string[] } {
  if (!value) {
    return { tokens: [], strongTokens: [] };
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return { tokens: [], strongTokens: [] };
  }

  const lower = trimmed.toLowerCase();
  const camelSeparated = trimmed.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  const collapsed = lower.replace(/[^a-z0-9]/g, "");
  const hasWhitespace = /\s/.test(trimmed);

  const strongSet = new Set<string>();
  if (!hasWhitespace && collapsed.length >= 4 && !/^[0-9]+$/.test(collapsed)) {
    strongSet.add(collapsed);
  }

  const tokenSet = new Set<string>();
  const orderedTokens: string[] = [];

  const pushToken = (token: string, targetSet: Set<string>) => {
    if (!targetSet.has(token)) {
      targetSet.add(token);
      orderedTokens.push(token);
    }
  };

  strongSet.forEach((token) => pushToken(token, tokenSet));

  const rawTokens = camelSeparated.replace(/[^a-z0-9]+/g, " ").split(" ");
  for (const raw of rawTokens) {
    const token = raw.trim();
    if (token.length === 0) {
      continue;
    }
    if (/^[0-9]+$/.test(token)) {
      continue;
    }
    if (GENERIC_TOKENS.has(token)) {
      continue;
    }
    if (token.length < 3) {
      continue;
    }
    pushToken(token, tokenSet);
  }

  const tokens = orderedTokens;
  const strongTokens = Array.from(strongSet);

  return { tokens, strongTokens };
}

function parseAggregateFromJsonLd(html: string) {
  try {
    const jsonMatches = html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
    for (const match of jsonMatches) {
      const payload = JSON.parse(match[1]);
      const aggregate = Array.isArray(payload)
        ? payload.find((item) => item?.aggregateRating)
        : payload?.aggregateRating;
      if (aggregate?.ratingValue) {
        const rating = Number(parseFloat(String(aggregate.ratingValue)).toFixed(1));
        const reviewCount = aggregate.reviewCount ? Number(String(aggregate.reviewCount).replace(/,/g, "")) : null;
        if (Number.isFinite(rating)) {
          return { rating, reviewCount };
        }
      }
    }
  } catch (error) {
    console.error("Failed to parse ld+json aggregateRating", error);
  }
  return null;
}

function parseRatingFromAria(html: string) {
  const ratingLabelMatch = html.match(/aria-label="([0-9](?:\.[0-9]+)?)\s+stars"/i);
  const ratingHiddenMatch = html.match(/aria-hidden="true">\s*([0-9](?:\.[0-9]+)?)/i);
  const reviewLabelMatch = html.match(/aria-label="[^"']*?([0-9,]+)\s+reviews"/i);

  const ratingSource = ratingLabelMatch?.[1] ?? ratingHiddenMatch?.[1];
  const rating = ratingSource ? Number(parseFloat(ratingSource).toFixed(1)) : null;
  const reviewCount = reviewLabelMatch ? Number(reviewLabelMatch[1].replace(/,/g, "")) : null;
  return rating || reviewCount ? { rating, reviewCount } : null;
}

function parseRatingFromPlainText(html: string) {
  const ratingMatch = html.match(/([0-9](?:\.[0-9]+)?)\s*★/);
  const reviewCountMatch = html.match(/\(([0-9,]+)\)/);

  const rating = ratingMatch ? Number(parseFloat(ratingMatch[1]).toFixed(1)) : null;
  const reviewCount = reviewCountMatch ? Number(reviewCountMatch[1].replace(/,/g, "")) : null;
  return rating || reviewCount ? { rating, reviewCount } : null;
}

function sanitizeSnapshot(
  url: string,
  rating: number | null,
  reviewCount: number | null,
  method: string
): ReviewSnapshot & { method: string } {
  const normalizedRating = rating !== null && Number.isFinite(rating) ? Number(rating.toFixed(1)) : null;
  const normalizedCount = reviewCount !== null && Number.isFinite(reviewCount)
    ? Math.min(Math.max(reviewCount, 0), MAX_REVIEW_COUNT)
    : null;

  return {
    averageRating: normalizedRating,
    reviewCount: normalizedCount,
    sourceUrl: url,
    method
  };
}

export async function getMapsSnapshot(
  query: string,
  providedUrl?: string,
  companyName?: string
): Promise<ReviewSnapshot & { method: string }> {
  const { MAPS_CACHE_TTL_MS } = getEnv();
  const cacheKey = `${CACHE_VERSION}::${query}::${providedUrl ?? ""}::${companyName ?? ""}`;

  const cached = cache.get(cacheKey);
  if (
    cached &&
    cached.expiresAt > Date.now() &&
    (cached.snapshot.averageRating !== null || cached.snapshot.reviewCount !== null)
  ) {
    return cached.snapshot;
  }

  const methodsTried: string[] = [];
  const queryTokens = tokenizeQuery(query);
  const { tokens: companyTokens, strongTokens: companyStrongTokens } = deriveIdentityTokens(companyName);
  const identityTokens = companyTokens.length > 0 ? companyTokens : queryTokens;
  const provisionalRequiredTokens = companyStrongTokens.length > 0 ? companyStrongTokens : companyTokens;
  const uniqueRequiredTokens = Array.from(new Set(provisionalRequiredTokens));
  const minRequiredMatches = uniqueRequiredTokens.length >= 2 ? 2 : uniqueRequiredTokens.length;
  const requiredTokenSet = new Set(uniqueRequiredTokens);
  const matchesIdentityTokens = (text: string | null | undefined) => {
    if (!text) {
      return false;
    }
    if (identityTokens.length === 0) {
      return true;
    }
    const normalized = text.toLowerCase();
    const matchedTokens = identityTokens.filter((token) => normalized.includes(token));
    if (matchedTokens.length === 0) {
      return false;
    }
    if (minRequiredMatches === 0) {
      return true;
    }
    const requiredMatches = matchedTokens.filter((token) => requiredTokenSet.has(token)).length;
    return requiredMatches >= minRequiredMatches;
  };

  const attemptPlace = async (url: string, method: string) => {
    const placeHtml = await fetchPlaceHtml(url);
    if (!placeHtml) {
      methodsTried.push(`${method}:fetch_failed`);
      return null;
    }

    const titleMatch = placeHtml.html.match(/<title>([^<]+)<\/title>/i);
    const decodeHtmlEntities = (value: string) =>
      value
        .replace(/&amp;/gi, "&")
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&#x2f;/gi, "/");
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : null;

    const identityMatch =
      matchesIdentityTokens(placeHtml.url) ||
      matchesIdentityTokens(title) ||
      matchesIdentityTokens(placeHtml.html.slice(0, 5000));

    const methodLabel = identityMatch ? method : `${method}:nomatch`;
    methodsTried.push(methodLabel);

    if (!identityMatch) {
      return sanitizeSnapshot(placeHtml.url, null, null, `${method}:nomatch`);
    }

    const jsonLd = parseAggregateFromJsonLd(placeHtml.html);
    if (jsonLd) {
      return sanitizeSnapshot(placeHtml.url, jsonLd.rating ?? null, jsonLd.reviewCount ?? null, method + ":ldjson");
    }

    const aria = parseRatingFromAria(placeHtml.html);
    if (aria) {
      return sanitizeSnapshot(placeHtml.url, aria.rating ?? null, aria.reviewCount ?? null, method + ":aria");
    }

    const plain = parseRatingFromPlainText(placeHtml.html);
    if (plain) {
      return sanitizeSnapshot(placeHtml.url, plain.rating ?? null, plain.reviewCount ?? null, method + ":regex");
    }

    return sanitizeSnapshot(placeHtml.url, null, null, method + ":none");
  };

  let resolvedProvidedUrl: string | undefined;
  if (providedUrl) {
    try {
      resolvedProvidedUrl = await followRedirect(providedUrl);
    } catch {
      resolvedProvidedUrl = providedUrl;
    }
  }

  const apiResolvedUrl = await resolveViaApiQuery(query);
  const headlessCandidateUrl = [resolvedProvidedUrl, apiResolvedUrl ?? undefined]
    .find((url) => typeof url === "string" && url.includes("/maps/place"))
    ?? undefined;

  let headlessSnapshot: (ReviewSnapshot & { method: string }) | null = null;
  const headless = await resolveWithHeadless(query, headlessCandidateUrl);
  if (headless) {
    const identityText = [headless.name, headless.title, headless.address].filter(Boolean).join(" | ");
    const matchesIdentity = matchesIdentityTokens(identityText);
    const methodLabel = matchesIdentity ? headless.strategy : `${headless.strategy}:nomatch`;
    methodsTried.push(methodLabel);
    const rating = matchesIdentity ? headless.rating : null;
    const reviewCount = matchesIdentity ? headless.reviewCount : null;

    headlessSnapshot = sanitizeSnapshot(headless.url, rating, reviewCount, methodLabel);
    if (matchesIdentity && (headlessSnapshot.averageRating !== null || headlessSnapshot.reviewCount !== null)) {
      cache.set(cacheKey, { snapshot: headlessSnapshot, expiresAt: Date.now() + MAPS_CACHE_TTL_MS });
      return headlessSnapshot;
    }
  }

  if (resolvedProvidedUrl && resolvedProvidedUrl.includes("/maps/place")) {
    const snapshot = await attemptPlace(resolvedProvidedUrl, "provided");
    if (snapshot && (snapshot.averageRating !== null || snapshot.reviewCount !== null)) {
      cache.set(cacheKey, { snapshot, expiresAt: Date.now() + MAPS_CACHE_TTL_MS });
      return snapshot;
    }
  }

  const search = await fetchSearchHtml(query);
  if (search) {
    const extracted = extractPlaceUrlFromHtml(search.html);
    if (extracted) {
      const snapshot = await attemptPlace(extracted, "serp_place");
      if (snapshot && (snapshot.averageRating !== null || snapshot.reviewCount !== null)) {
        cache.set(cacheKey, { snapshot, expiresAt: Date.now() + MAPS_CACHE_TTL_MS });
        return snapshot;
      }
    }
  }

  if (apiResolvedUrl && apiResolvedUrl.includes("/maps/place")) {
    if (!resolvedProvidedUrl || resolvedProvidedUrl !== apiResolvedUrl) {
      const snapshot = await attemptPlace(apiResolvedUrl, "api_query");
      if (snapshot && (snapshot.averageRating !== null || snapshot.reviewCount !== null)) {
        cache.set(cacheKey, { snapshot, expiresAt: Date.now() + MAPS_CACHE_TTL_MS });
        return snapshot;
      }
    }
  }

  const jina = await fetchViaJina(query, identityTokens, uniqueRequiredTokens, minRequiredMatches, "jina_text");
  if (jina) {
    return jina;
  }

  if (minRequiredMatches > 1) {
    const relaxedRequiredTokens = uniqueRequiredTokens.slice(0, 1);
    const relaxed = await fetchViaJina(
      query,
      identityTokens,
      relaxedRequiredTokens,
      relaxedRequiredTokens.length,
      "jina_text_relaxed"
    );
    if (relaxed) {
      return relaxed;
    }
  }

  const looseTokens = queryTokens.length > 0 ? queryTokens : identityTokens;
  if (looseTokens.length > 0) {
    const loose = await fetchViaJina(query, looseTokens, [], 0, "jina_text_loose");
    if (loose) {
      return loose;
    }
  }

  const fallbackUrl = headlessSnapshot?.sourceUrl ?? search?.url ?? resolvedProvidedUrl ?? providedUrl ?? "";
  const fallbackMethod = headlessSnapshot?.method ?? (methodsTried.length ? methodsTried.join("->") : "none");
  const fallback = sanitizeSnapshot(
    fallbackUrl,
    headlessSnapshot?.averageRating ?? null,
    headlessSnapshot?.reviewCount ?? null,
    fallbackMethod
  );

  if (fallback.averageRating === null && fallback.reviewCount === null) {
    return {
      averageRating: null,
      reviewCount: null,
      sourceUrl: null,
      method: "not_found"
    } satisfies ReviewSnapshot & { method: string };
  }

  return fallback;
}

async function fetchViaJina(
  query: string,
  identityTokens: string[],
  requiredTokens: string[],
  minRequiredMatches: number,
  methodLabel = "jina_text"
) {
  const jinaUrl = `https://r.jina.ai/https://maps.google.com/maps?q=${encodeURIComponent(query)}`;
  const matchTokens = identityTokens.length > 0 ? identityTokens : tokenizeQuery(query);
  const primaryTokens = requiredTokens.length > 0
    ? requiredTokens
    : matchTokens.slice(0, Math.min(matchTokens.length, 3));

  if (matchTokens.length === 0) {
    return null;
  }

  try {
    const response = await fetchWithTimeout(jinaUrl, {
      headers: {
        "User-Agent": USER_AGENT
      }
    });
    if (!response.ok) {
      return null;
    }
    const text = await response.text();
    TEXT_PATTERN.lastIndex = 0;
    const matches = [...text.matchAll(TEXT_PATTERN)];

    if (matches.length === 0) {
      return null;
    }

    const candidates = matches.slice(0, 5).map((match) => {
      const index = match.index ?? 0;
      const snippet = text
        .slice(Math.max(0, index - 250), Math.min(text.length, index + match[0].length + 250))
        .replace(/\s+/g, " ")
        .trim();
      const rating = Number(match[1]);
      const reviewCount = Number(match[2].replace(/,/g, ""));
      return {
        rating,
        reviewCount: Number.isFinite(reviewCount) ? reviewCount : null,
        snippet
      };
    });

    console.log("maps jina candidates", {
      query,
      candidate_count: matches.length,
      candidates
    });

    const scored = candidates
      .map((candidate) => {
        const normalizedSnippet = candidate.snippet.toLowerCase();
        const matchedTokens = matchTokens.filter((token) => normalizedSnippet.includes(token));
        const identityMatches = requiredTokens.length > 0
          ? requiredTokens.filter((token) => normalizedSnippet.includes(token))
          : matchedTokens;
        const primaryMatches = primaryTokens.filter((token) => normalizedSnippet.includes(token));
        const tokenScore = matchedTokens.length + primaryMatches.length;
        const hasIdentityMatch = requiredTokens.length === 0
          ? matchedTokens.length > 0
          : identityMatches.length >= Math.max(1, minRequiredMatches);
        return {
          ...candidate,
          matchedTokens,
          identityMatches,
          primaryMatches,
          tokenScore,
          hasIdentityMatch
        };
      })
      .filter((candidate) => candidate.tokenScore > 0 && candidate.hasIdentityMatch)
      .sort((a, b) => {
        const identityDiff = (b.identityMatches?.length ?? 0) - (a.identityMatches?.length ?? 0);
        if (identityDiff !== 0) {
          return identityDiff;
        }
        const primaryDiff = b.primaryMatches.length - a.primaryMatches.length;
        if (primaryDiff !== 0) {
          return primaryDiff;
        }
        const scoreDiff = b.tokenScore - a.tokenScore;
        if (scoreDiff !== 0) {
          return scoreDiff;
        }
        return (b.reviewCount ?? 0) - (a.reviewCount ?? 0);
      });

    const primary = scored[0];
    if (!primary) {
      return null;
    }

    if (!Number.isFinite(primary.rating) || primary.reviewCount === null) {
      return null;
    }

    return sanitizeSnapshot(jinaUrl, primary.rating, primary.reviewCount, methodLabel);
  } catch (error) {
    console.error("Jina fallback failed", error);
    return null;
  }
}
