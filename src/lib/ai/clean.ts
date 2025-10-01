import { callOpenRouter } from "../openrouter";
import { getEnv } from "../env";

export type RawLeadRecord = Record<string, string>;

export type CleanLead = {
  lead_id: string;
  company: string;
  industry?: string;
  website?: string;
  location?: string;
  email?: string;
  notes?: string;
  maps_url?: string;
  years_in_business?: number | null;
  normalized: RawLeadRecord;
  provenance: Record<string, string>;
};

const WEBSITE_FIELDS = ["website", "website_url", "url", "domain", "homepage"];
const INDUSTRY_FIELDS = ["industry", "vertical", "segment", "category"];
const LOCATION_FIELDS = ["location", "city", "state", "province", "country", "region", "address"];
const EMAIL_FIELDS = ["email", "email_address", "contact_email"];
const FOUNDED_FIELDS = ["founded", "year_founded", "founded_year", "established", "since"];

const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>()]+/gi;

function firstValue(record: RawLeadRecord, keys: string[]): string | undefined {
  for (const key of keys) {
    if (record[key]) {
      return record[key];
    }
  }
  return undefined;
}

function normalizeWebsite(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }

  let value = raw.trim();
  if (value === "") {
    return undefined;
  }

  if (!value.startsWith("http")) {
    value = `https://${value}`;
  }

  try {
    const url = new URL(value);
    if (!url.hostname || url.hostname === "localhost") {
      return undefined;
    }
    url.hash = "";
    if (!url.pathname || url.pathname === "/") {
      url.pathname = "";
    }
    return url.toString();
  } catch {
    return undefined;
  }
}

function deriveWebsiteFromEmail(raw?: string): string | undefined {
  if (!raw) {
    return undefined;
  }
  const email = raw.trim().toLowerCase();
  if (!email.includes("@")) {
    return undefined;
  }
  const domain = email.split("@")[1];
  if (!domain) {
    return undefined;
  }
  return normalizeWebsite(domain);
}

function combineLocation(record: RawLeadRecord): string | undefined {
  const parts = LOCATION_FIELDS.map((field) => record[field]).filter(Boolean).map((value) => value.trim());
  if (parts.length === 0) {
    return undefined;
  }
  const unique = Array.from(new Set(parts));
  return unique.join(", ");
}

function parseYearsInBusiness(record: RawLeadRecord): number | null {
  const foundedRaw = firstValue(record, FOUNDED_FIELDS);
  if (!foundedRaw) {
    return null;
  }
  const yearMatch = foundedRaw.match(/(19|20)\d{2}/);
  if (!yearMatch) {
    return null;
  }
  const year = Number(yearMatch[0]);
  if (!Number.isFinite(year) || year > new Date().getFullYear()) {
    return null;
  }
  return Math.max(new Date().getFullYear() - year, 0);
}

function detectMapsUrl(record: RawLeadRecord): string | undefined {
  for (const rawValue of Object.values(record)) {
    if (!rawValue) {
      continue;
    }

    const candidates = rawValue.match(URL_IN_TEXT_REGEX);
    if (!candidates) {
      continue;
    }

    for (const candidate of candidates) {
      const normalized = candidate.replace(/[),.;]+$/, "");
      try {
        const url = new URL(normalized);
        const host = url.hostname.toLowerCase();
        const path = url.pathname.toLowerCase();

        const isGoogleHost = host.includes("google.");
        const hasMapsHint = host.includes("maps") || path.includes("/maps") || url.searchParams.has("cid");
        const isShortMapLink = host === "goo.gl" && path.startsWith("/maps");
        const isMapsAppLink = host === "maps.app.goo.gl";

        if ((isGoogleHost && hasMapsHint) || isShortMapLink || isMapsAppLink) {
          return normalized;
        }
      } catch {
        // Ignore invalid URL strings and keep checking.
      }
    }
  }
  return undefined;
}

async function runAiCleaner(base: CleanLead, enabled: boolean): Promise<CleanLead> {
  if (!enabled) {
    return base;
  }

  try {
    const response = await callOpenRouter([
      {
        role: "system",
        content:
          "Normalize lead data. Return JSON with fields: company, website, location, industry, maps_url, notes. Keep empty string for missing." +
          " Only use information present in the input."
      },
      {
        role: "user",
        content: JSON.stringify(base)
      }
    ]);

    return {
      ...base,
      company: response.company ?? base.company,
      website: response.website || base.website,
      location: response.location || base.location,
      industry: response.industry || base.industry,
      maps_url: response.maps_url || base.maps_url,
      notes: response.notes || base.notes
    };
  } catch (error) {
    console.error("AI cleaner failed", error);
    return base;
  }
}

export async function cleanLeadRecord(
  record: RawLeadRecord,
  fallbackLeadId: string,
  options?: { useAi?: boolean }
): Promise<CleanLead> {
  const leadId = record.lead_id || record.id || fallbackLeadId;
  const company = record.company_name || record.company || record.account || "Unknown Company";

  const primaryWebsite = normalizeWebsite(firstValue(record, WEBSITE_FIELDS));
  const derivedWebsite = deriveWebsiteFromEmail(firstValue(record, EMAIL_FIELDS));
  const website = primaryWebsite ?? derivedWebsite;

  const email = firstValue(record, EMAIL_FIELDS);
  const industry = firstValue(record, INDUSTRY_FIELDS);
  const location = combineLocation(record);
  const yearsInBusiness = parseYearsInBusiness(record);
  const mapsUrl = detectMapsUrl(record);

  const base: CleanLead = {
    lead_id: leadId,
    company,
    industry,
    website,
    location,
    email,
    years_in_business: yearsInBusiness,
    maps_url: mapsUrl,
    notes: record.notes,
    normalized: record,
    provenance: {
      website: primaryWebsite ? "csv" : derivedWebsite ? "email" : "unknown",
      location: location ? "csv" : "unknown",
      maps_url: mapsUrl ? "csv" : "none"
    }
  };

  const { OPENROUTER_API_KEY } = getEnv();
  if (!OPENROUTER_API_KEY) {
    return base;
  }

  const useAi = options?.useAi ?? process.env.AI_CLEANER_ENABLED === "true";
  return runAiCleaner(base, useAi);
}
