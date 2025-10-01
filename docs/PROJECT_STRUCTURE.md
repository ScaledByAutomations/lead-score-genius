# Project Structure

```
lead-score-genius/
├─ docs/
│  ├─ ADR.md
│  ├─ PRD.md
│  ├─ PROJECT_STRUCTURE.md
│  └─ WORKFLOW.md
├─ public/
│  ├─ next.svg
│  ├─ vercel.svg
│  └─ (static assets served by Next.js)
├─ src/
│  ├─ app/
│  │  ├─ api/
│  │  │  ├─ maps-extract/
│  │  │  │  └─ route.ts
│  │  │  ├─ save/
│  │  │  │  └─ route.ts
│  │  │  └─ score-leads/
│  │  │     ├─ enqueue/
│  │  │     │  └─ route.ts
│  │  │     ├─ jobs/
│  │  │     │  └─ [jobId]/route.ts
│  │  │     └─ route.ts
│  │  ├─ favicon.ico
│  │  ├─ globals.css
│  │  ├─ layout.tsx
│  │  └─ page.tsx
│  └─ lib/
│     ├─ ai/
│     │  ├─ clean.ts
│     │  └─ scoring.ts
│     ├─ enrich/
│     │  ├─ maps.ts
│     │  ├─ mapsHeadless.ts
│     │  ├─ mapsResolve.ts
│     │  └─ website.ts
│     ├─ env.ts
│     ├─ jobQueue.ts
│     ├─ openrouter.ts
│     ├─ reviews.ts
│     ├─ scoreLeads.ts
│     ├─ supabase.ts
│     └─ types.ts
├─ supabase/
│  ├─ migrations/
│  │  └─ 0001_init.sql
│  ├─ policies.sql
│  └─ functions/
├─ eslint.config.mjs
├─ next.config.ts
├─ package.json
├─ pnpm-lock.yaml
├─ postcss.config.mjs
├─ README.md
└─ tsconfig.json
```

> Note: `node_modules/` and `.next/` are omitted for brevity.

## Conventions
- Application code lives under `src/`, using the Next.js App Router structure.
- Supabase artifacts reside inside `supabase/` (migrations, policies, edge functions) and should be kept in sync with the Supabase CLI.
- Documentation resides in `docs/` and must be updated with every meaningful change to the codebase.
- API integrations and shared types live in `src/lib/` to keep server routes and client components aligned.
