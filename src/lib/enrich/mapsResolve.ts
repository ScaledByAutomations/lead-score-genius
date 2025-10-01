import { getEnv } from "../env";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export async function fetchWithTimeout(url: string, init?: RequestInit): Promise<Response> {
  const { MAPS_TIMEOUT_MS } = getEnv();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MAPS_TIMEOUT_MS);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "User-Agent": USER_AGENT,
        ...(init?.headers ?? {})
      }
    });
  } finally {
    clearTimeout(timeout);
  }
}

export async function followRedirect(url: string): Promise<string> {
  try {
    const response = await fetchWithTimeout(url, {
      redirect: "follow"
    });

    return response.url;
  } catch (error) {
    console.error("Failed to resolve redirect", error);
    return url;
  }
}

export async function fetchSearchHtml(query: string): Promise<{ html: string; url: string } | null> {
  const searchUrl = `https://www.google.com/maps/search/${encodeURIComponent(query)}`;

  try {
    const response = await fetchWithTimeout(searchUrl, { redirect: "follow" });
    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return { html, url: response.url };
  } catch (error) {
    console.error("Failed to load Google Maps search page", error);
    return null;
  }
}

export function extractPlaceUrlFromHtml(html: string): string | null {
  const decoded = html.replace(/\\u003d/g, "=");
  const match = decoded.match(/https:\/\/www\.google\.com\/maps\/place\/[^"]+/);
  if (!match) {
    return null;
  }
  return match[0];
}

export async function resolveViaApiQuery(query: string): Promise<string | null> {
  const apiUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
  const resolved = await followRedirect(apiUrl);
  if (resolved.includes("/maps/place")) {
    return resolved;
  }
  return null;
}

export async function fetchPlaceHtml(placeUrl: string): Promise<{ html: string; url: string } | null> {
  try {
    const response = await fetchWithTimeout(placeUrl, {
      redirect: "follow"
    });

    if (!response.ok) {
      return null;
    }

    const html = await response.text();
    return { html, url: response.url };
  } catch (error) {
    console.error("Failed to load Google Maps place page", error);
    return null;
  }
}
