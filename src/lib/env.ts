const boolean = (value: string | undefined, fallback = false) => {
  if (value === undefined) {
    return fallback;
  }
  return value === "true" || value === "1";
};

export type EnvConfig = {
  OPENROUTER_API_KEY: string;
  OPENROUTER_BASE_URL: string;
  OPENROUTER_MODEL: string;
  NEXT_PUBLIC_SUPABASE_URL?: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  MAPS_HEADLESS: boolean;
  MAPS_TIMEOUT_MS: number;
  MAPS_CACHE_TTL_MS: number;
  MAPS_LOOKUP_MAX_CONCURRENCY: number;
  MAPS_LOOKUP_MIN_DELAY_MS: number;
  MAPS_LOOKUP_BASE_BACKOFF_MS: number;
  MAPS_LOOKUP_MAX_BACKOFF_MS: number;
  MAPS_LOOKUP_BACKOFF_RESET_MS: number;
};

let cachedEnv: EnvConfig | null = null;

export function getEnv(): EnvConfig {
  if (cachedEnv) {
    return cachedEnv;
  }

  const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
  if (!OPENROUTER_API_KEY) {
    throw new Error("OPENROUTER_API_KEY is not set. Add it to .env.local before scoring leads.");
  }

  const OPENROUTER_BASE_URL = process.env.OPENROUTER_BASE_URL ?? "https://openrouter.ai/api/v1";
  const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL ?? "openai/gpt-5";

  const MAPS_TIMEOUT_MS = Number(process.env.MAPS_TIMEOUT_MS ?? "15000");
  const MAPS_CACHE_TTL_MS = Number(process.env.MAPS_CACHE_TTL_MS ?? "900000"); // 15 minutes
  const MAPS_LOOKUP_MAX_CONCURRENCY = Number(process.env.MAPS_LOOKUP_MAX_CONCURRENCY ?? "4");
  const MAPS_LOOKUP_MIN_DELAY_MS = Number(process.env.MAPS_LOOKUP_MIN_DELAY_MS ?? "250");
  const MAPS_LOOKUP_BASE_BACKOFF_MS = Number(process.env.MAPS_LOOKUP_BASE_BACKOFF_MS ?? "1200");
  const MAPS_LOOKUP_MAX_BACKOFF_MS = Number(process.env.MAPS_LOOKUP_MAX_BACKOFF_MS ?? "8000");
  const MAPS_LOOKUP_BACKOFF_RESET_MS = Number(process.env.MAPS_LOOKUP_BACKOFF_RESET_MS ?? "20000");

  cachedEnv = {
    OPENROUTER_API_KEY,
    OPENROUTER_BASE_URL,
    OPENROUTER_MODEL,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    MAPS_HEADLESS: boolean(process.env.MAPS_HEADLESS, false),
    MAPS_TIMEOUT_MS,
    MAPS_CACHE_TTL_MS,
    MAPS_LOOKUP_MAX_CONCURRENCY,
    MAPS_LOOKUP_MIN_DELAY_MS,
    MAPS_LOOKUP_BASE_BACKOFF_MS,
    MAPS_LOOKUP_MAX_BACKOFF_MS,
    MAPS_LOOKUP_BACKOFF_RESET_MS
  };

  return cachedEnv;
}
