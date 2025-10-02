import { mkdir } from "fs/promises";

import chromium from "@sparticuz/chromium";

import { getEnv } from "../env";

export type HeadlessExtraction = {
  url: string;
  rating: number | null;
  reviewCount: number | null;
  strategy: "headless_serp_place" | "headless_place" | "headless_serp_panel";
  name: string | null;
  title: string | null;
  address: string | null;
};

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const isPlaceUrl = (url?: string | null) => !!url && url.includes("/maps/place/");

export async function resolveWithHeadless(query: string, providedUrl?: string): Promise<HeadlessExtraction | null> {
  const { MAPS_HEADLESS, MAPS_TIMEOUT_MS } = getEnv();

  if (!MAPS_HEADLESS) {
    return null;
  }

  try {
    const puppeteer = await import("puppeteer");
    const cacheDir = process.env.PUPPETEER_CACHE_DIR || "/tmp/puppeteer-cache";
    await mkdir(cacheDir, { recursive: true }).catch(() => {});
    const executablePath = (await chromium.executablePath(cacheDir)) ?? undefined;
    const browser = await puppeteer.launch({
      headless: true,
      executablePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      timeout: MAPS_TIMEOUT_MS
    });

    try {
      const page = await browser.newPage();
      const readIdentity = async (): Promise<{ name: string | null; title: string | null; address: string | null }> => {
        return page
          .evaluate(() => {
            const safeText = (value: string | null | undefined) => {
              if (!value) {
                return null;
              }
              const trimmed = value.trim();
              return trimmed.length > 0 ? trimmed : null;
            };

            const getFirstText = (selectors: string[]) => {
              for (const selector of selectors) {
                const element = document.querySelector(selector);
                if (element && element.textContent) {
                  const text = element.textContent.trim();
                  if (text.length > 0) {
                    return text;
                  }
                }
              }
              return null;
            };

            const heading = getFirstText([
              '[role="heading"][aria-level="1"]',
              'h1 span[role="heading"]',
              'h1 span'
            ]);
            const metaName = document.querySelector('meta[itemprop="name"]');
            const altName = metaName?.getAttribute('content') || metaName?.textContent || null;

            const address = getFirstText([
              '[data-item-id="address"]',
              'button[data-item-id="address"]',
              '[aria-label*="address"]'
            ]);

            return {
              name: safeText(heading) ?? safeText(altName),
              title: safeText(document.title),
              address: safeText(address)
            };
          })
          .catch(() => ({ name: null, title: null, address: null }));
      };
      const readRatingAndReviews = async (): Promise<{ rating: number | null; reviewCount: number | null }> => {
        const result = await page
          .evaluate(() => {
            const cleanNumber = (raw: string | null | undefined) => {
              if (!raw) return null;
              const normalized = raw.replace(/,/g, "");
              const match = normalized.match(/([0-9]+(?:\.[0-9]+)?)/);
              return match ? Number(match[1]) : null;
            };

            const ratingValues: number[] = [];
            const reviewValues: number[] = [];

            const pushRating = (value: number | null | undefined) => {
              if (typeof value === "number" && Number.isFinite(value)) {
                const normalized = Number(value.toFixed(2));
                if (normalized > 0 && normalized <= 5.1) {
                  ratingValues.push(normalized);
                }
              }
            };

            const pushReview = (value: number | null | undefined) => {
              if (typeof value === "number" && Number.isFinite(value)) {
                const normalized = Math.round(value);
                if (normalized > 0) {
                  reviewValues.push(normalized);
                }
              }
            };

            const collectFromJsonLd = () => {
              const scripts = Array.from(document.querySelectorAll('script[type="application/ld+json"]'));
              for (const script of scripts) {
                try {
                  const text = script.textContent || "";
                  if (!text.trim()) continue;
                  const parsed = JSON.parse(text);
                  const queue = Array.isArray(parsed) ? [...parsed] : [parsed];
                  while (queue.length > 0) {
                    const item = queue.shift();
                    if (!item || typeof item !== "object") {
                      continue;
                    }
                    if (item.aggregateRating) {
                      const aggregate = item.aggregateRating as Record<string, unknown>;
                      pushRating(cleanNumber(String(aggregate.ratingValue ?? aggregate.rating ?? "")));
                      pushReview(cleanNumber(String(aggregate.reviewCount ?? aggregate.ratingCount ?? "")));
                    }
                    for (const value of Object.values(item)) {
                      if (value && typeof value === "object") {
                        queue.push(value);
                      }
                    }
                  }
                } catch {
                  // Ignore invalid JSON payloads.
                }
              }
            };

            const collectFromDocument = () => {
              const starNode = document.querySelector('[aria-label*="star"] span[aria-hidden="true"]');
              const altStarNode = document.querySelector('span[role="img"][aria-label*="star"]');
              const starText = (starNode?.textContent || altStarNode?.textContent || '').trim();
              pushRating(cleanNumber(starText));

              const ratingCandidates = Array.from(document.querySelectorAll('[aria-label]'))
                .map((el) => el.getAttribute('aria-label') || '')
                .filter((label) => /(stars?|rated|rating)/i.test(label || ''));
              for (const label of ratingCandidates) {
                pushRating(cleanNumber(label));
              }

              const ratingMeta = document.querySelector('meta[itemprop="ratingValue"], meta[itemprop="rating"]');
              pushRating(cleanNumber(ratingMeta?.getAttribute('content') || ratingMeta?.textContent || undefined));

              const ratingContainer = document.querySelector('[jslog*="rating"]');
              if (ratingContainer) {
                pushRating(cleanNumber(ratingContainer.textContent || undefined));
                pushRating(cleanNumber(ratingContainer.getAttribute('aria-label') || undefined));
              }

              const reviewCandidates = Array.from(
                document.querySelectorAll('span[aria-label], button[aria-label], a[aria-label], div[jslog*="reviews"]')
              )
                .map((el) => el.getAttribute('aria-label') || el.textContent || '')
                .filter((label) => /reviews?/i.test(label || ''));
              for (const label of reviewCandidates) {
                pushReview(cleanNumber(label));
              }

              const reviewMeta = document.querySelector('meta[itemprop="reviewCount"], meta[itemprop="ratingCount"]');
              pushReview(cleanNumber(reviewMeta?.getAttribute('content') || reviewMeta?.textContent || undefined));

              const reviewContainer = document.querySelector('[jslog*="rating"]') || document.querySelector('[jslog*="reviews"]');
              if (reviewContainer) {
                const label = reviewContainer.getAttribute('aria-label') || reviewContainer.textContent || '';
                const matches = label.match(/([0-9][0-9,]*)/g) || [];
                for (const match of matches) {
                  pushReview(cleanNumber(match));
                }
              }

              const bodyText = document.body.innerText || '';
              const textMatch = bodyText.match(/([0-9](?:\.[0-9]+)?)\s*(?:★|stars?)?\s*\(([0-9,]+)\s+reviews?\)/i);
              if (textMatch) {
                pushRating(Number(textMatch[1]));
                pushReview(Number(textMatch[2].replace(/,/g, '')));
              }

              const altMatch = bodyText.match(/([0-9](?:\.[0-9]+)?)\s*out of 5\s*\(([0-9,]+)\s+Google reviews\)/i);
              if (altMatch) {
                pushRating(Number(altMatch[1]));
                pushReview(Number(altMatch[2].replace(/,/g, '')));
              }

              const countMatch = bodyText.match(/([0-9][0-9,]*)\s+(?:Google\s+)?reviews?/i);
              if (countMatch) {
                pushReview(Number(countMatch[1].replace(/,/g, '')));
              }
            };

            collectFromJsonLd();
            collectFromDocument();

            const rating = ratingValues.length > 0 ? Math.max(...ratingValues) : null;
            const reviewCount = reviewValues.length > 0 ? Math.max(...reviewValues) : null;

            return { rating, reviewCount };
          })
          .catch(() => ({ rating: null, reviewCount: null }));

        const rating = result.rating !== null && Number.isFinite(result.rating)
          ? Number(result.rating.toFixed(1))
          : null;
        const reviewCount = result.reviewCount !== null && Number.isFinite(result.reviewCount)
          ? Math.max(0, Math.round(result.reviewCount))
          : null;

        return { rating, reviewCount };
      };
      const capturePlace = async (
        targetUrl: string,
        captureStrategy: HeadlessExtraction["strategy"]
      ): Promise<HeadlessExtraction> => {
        if (!page.url().startsWith(targetUrl)) {
          await page.goto(targetUrl, { waitUntil: "networkidle2", timeout: MAPS_TIMEOUT_MS });
        }

        await delay(1500);
        await page
          .waitForSelector(
            'span[aria-hidden="true"], span[role="img"][aria-label*="star"], [itemprop="ratingValue"], div[jslog*="rating"]',
            {
              timeout: MAPS_TIMEOUT_MS
            }
          )
          .catch(() => null);

        const ratingAndReviews = await readRatingAndReviews();
        const identity = await readIdentity();
        return {
          url: targetUrl,
          rating: ratingAndReviews.rating,
          reviewCount: ratingAndReviews.reviewCount,
          strategy: captureStrategy,
          name: identity.name,
          title: identity.title,
          address: identity.address
        };
      };

      if (isPlaceUrl(providedUrl)) {
        return await capturePlace(providedUrl!, "headless_place");
      }

      const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;
      await page.goto(searchUrl, { waitUntil: "networkidle2", timeout: MAPS_TIMEOUT_MS });
      const initialUrl = page.url();

      if (isPlaceUrl(initialUrl)) {
        return await capturePlace(initialUrl, "headless_place");
      }

      await page
        .waitForFunction(
          () => {
            const anchor = Array.from(document.querySelectorAll('a[href*="/maps/place"]')) as HTMLAnchorElement[];
            return anchor.find((el) => el.href.includes("/maps/place"))?.href ?? null;
          },
          { timeout: MAPS_TIMEOUT_MS }
        )
        .catch(() => null);

      const placeLink = await page.evaluate(() => {
        const anchors = Array.from(document.querySelectorAll('a[href*="/maps/place"]')) as HTMLAnchorElement[];
        return anchors.find((anchor) => anchor.href.includes("/maps/place"))?.href ?? null;
      });

      if (isPlaceUrl(placeLink)) {
        return await capturePlace(placeLink!, "headless_serp_place");
      }

      const serpExtraction = await readRatingAndReviews();
      const serpIdentity = await readIdentity();
      if (serpExtraction.rating !== null || serpExtraction.reviewCount !== null) {
        return {
          url: initialUrl,
          rating: serpExtraction.rating,
          reviewCount: serpExtraction.reviewCount,
          strategy: "headless_serp_panel",
          name: serpIdentity.name,
          title: serpIdentity.title,
          address: serpIdentity.address
        } satisfies HeadlessExtraction;
      }

      return null;
    } finally {
      await browser.close().catch(() => undefined);
    }
  } catch (error) {
    console.error("Headless Google Maps resolution failed", error);
    return null;
  }
}
