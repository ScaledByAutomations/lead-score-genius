# Architecture Decision Records

## ADR 0001: Adopt Next.js App Router as the Web Framework
- **Context**: We needed a modern React framework for Lead Score Genius that supports server-side rendering, static generation, and an opinionated directory structure suitable for rapid iteration.
- **Decision**: Use Next.js 15 with the App Router and React 19. The project was bootstrapped with `create-next-app` and keeps the default `src/app` layout.
- **Consequences**: We inherit built-in routing, image optimization, and streaming support. Developers must follow the App Router conventions (segments, layout.tsx) and adhere to React Server Component boundaries when introducing asynchronous data fetching.

## ADR 0002: Select Supabase as the Backend Platform
- **Context**: The Lead Score Genius roadmap includes storing scored lead runs, persisting user preferences, and potentially leveraging Postgres features such as RLS.
- **Decision**: Use Supabase for database, auth, edge functions, and storage. The repository already contains the `supabase/` scaffold for migrations and policies even though no migrations exist yet.
- **Consequences**: Future backend work should live inside Supabase migrations, policies, and edge functions. Supabase client integration will be required on the Next.js side, and developers must understand Supabase CLI workflows.

## ADR 0003: Use Tailwind CSS v4 (PostCSS plugin) for Styling
- **Context**: We wanted consistent utility-first styling across Lead Score Genius with minimal custom CSS while keeping bundle size small.
- **Decision**: Adopt Tailwind CSS v4 with the `@tailwindcss/postcss` plugin, configured in `postcss.config.mjs` and used via global import in `src/app/globals.css`.
- **Consequences**: Components rely on Tailwind utility classes. Any theming or design tokens should extend Tailwind configuration. Developers should avoid mixing multiple styling paradigms without documenting additional ADRs.

## ADR 0004: Perform Lead Scoring Client-Side via CSV Uploads *(Superseded)*
- **Context**: Initial Lead Score Genius user research emphasized a frictionless prototype that works without backend deployment, allowing iteration on the scoring model.
- **Decision**: Parse CSV files and compute scores entirely in the browser using pure TypeScript utilities within `src/app/page.tsx`.
- **Consequences**: There is no persistence or server validation yet, and large files may impact browser performance. This approach has now been replaced by ADR 0005 as requirements expanded beyond deterministic heuristics.

## ADR 0005: Delegate Lead Scoring to OpenRouter GPT-5 via Server API Route
- **Context**: The Lead Score Genius scoring matrix evolved to require nuanced reasoning, contextual weighting, and detailed narrative output. Maintaining this logic purely in the browser became brittle and duplicated business rules.
- **Decision**: Move lead scoring to a server-side endpoint (`src/app/api/score-leads/route.ts`) that calls the OpenRouter GPT-5 model. The API prompt encodes the weighting rules, forcing GPT to return structured JSON aligned with the schema.
- **Consequences**: The application now depends on an OpenRouter API key configured in `.env.local`. Server-side execution protects the key and keeps response parsing centralized, but introduces latency and external service dependency. The server recomputes weighted sums from the model's per-factor scores to preserve determinism even when the LLM disagrees with the arithmetic. An in-memory job queue (`src/lib/jobQueue.ts`) now processes large uploads asynchronously: the dashboard enqueues batches above ~150 leads, polls `/api/score-leads/jobs/:id` for progress, and streams partial results while the worker chunk processes with a concurrency cap of five. The handler still emits safe fallback rows when enrichment or scoring fails so the client can display partial results instead of crashing. Future offline or fallback modes must account for OpenRouter downtime and the lack of persistence for the in-memory queue in serverless deployments.

## ADR 0006: Scrape Google Maps for Review Signals
- **Context**: The Lead Score Genius scoring rubric requires objective review counts and ratings to feed the Reviews and Revenue proxy factors. CSV exports rarely include this metadata.
- **Decision**: Implement a layered enrichment pipeline (`src/lib/enrich/maps.ts`) that follows Maps redirects, parses statically available spans (including `aria-hidden="true"` rating nodes and localized review labels), and optionally falls back to a headless Puppeteer crawl when the static SERP does not reveal a `/maps/place` URL.
- **Consequences**: Scraping may fail if Google throttles requests or changes markup. The system records the extraction method for debugging and returns null scores when parsing fails. Operators can override with a `/maps/place` URL in the CSV. A future transition to the official Places API should supersede this ADR.
