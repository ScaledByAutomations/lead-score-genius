import { getEnv } from "../env";

export type WebsiteSignals = {
  url: string;
  ok: boolean;
  status?: number;
  baseScore: number;
  bonuses: {
    pricing: boolean;
    booking: boolean;
    cta: boolean;
  };
  finalScore: number;
  method: string;
};

function normalizeFinalScore(base: number, bonuses: number): number {
  const total = base + bonuses;
  const normalized = Math.round(total / 2.5);
  return Math.min(Math.max(normalized, 0), 10);
}

function detectPricing(html: string): boolean {
  return /pricing|plans|subscription|per month|per year|rate card/i.test(html);
}

function detectBooking(html: string): boolean {
  return /schedule|book now|book online|calendly|appointments?|booking/i.test(html);
}

function detectCta(html: string): boolean {
  return /request (?:a )?quote|sign up|buy now|get started|contact us|call now/i.test(html);
}

function detectRecentUpdate(html: string): boolean {
  const currentYear = new Date().getFullYear();
  const recentYears = [currentYear, currentYear - 1, currentYear - 2];
  return recentYears.some((year) => html.includes(String(year)));
}

async function fetchWebsite(url: string): Promise<Response | null> {
  const { MAPS_TIMEOUT_MS } = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAPS_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
      }
    });
    return response;
  } catch (error) {
    console.error("Website fetch failed", error);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function analyzeWebsite(url?: string): Promise<WebsiteSignals | null> {
  if (!url) {
    return null;
  }

  const httpVariants = [url];
  if (url.startsWith("https://")) {
    httpVariants.push(url.replace("https://", "http://"));
  }

  for (const variant of httpVariants) {
    const response = await fetchWebsite(variant);

    if (!response) {
      continue;
    }

    if (!response.ok || !response.headers.get("content-type")?.includes("text")) {
      const baseScore = 4;
      const finalScore = normalizeFinalScore(baseScore, 0);
      return {
        url: variant,
        ok: false,
        status: response.status,
        baseScore,
        bonuses: { pricing: false, booking: false, cta: false },
        finalScore,
        method: "http_status"
      };
    }

    const html = await response.text();
    const htmlLower = html.toLowerCase();

    const baseScore = detectRecentUpdate(html) ? 10 : htmlLower.includes("copyright") ? 6 : 5;
    const pricing = detectPricing(htmlLower);
    const booking = detectBooking(htmlLower);
    const cta = detectCta(htmlLower);

    const bonus = (pricing ? 5 : 0) + (booking ? 5 : 0) + (cta ? 5 : 0);
    const finalScore = normalizeFinalScore(baseScore, bonus);

    return {
      url: variant,
      ok: true,
      status: response.status,
      baseScore,
      bonuses: { pricing, booking, cta },
      finalScore,
      method: "http_fetch"
    };
  }

  const baseScore = 4;
  const finalScore = normalizeFinalScore(baseScore, 0);
  return {
    url,
    ok: false,
    baseScore,
    bonuses: { pricing: false, booking: false, cta: false },
    finalScore,
    method: "fallback"
  };
}
