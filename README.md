# Lead Score Genius

Lead Score Genius is a web app that takes a spreadsheet full of leads, researches each company for you, scores them, and explains why they’re worth your time. It is built so sales, marketing, and RevOps teams can make sense of huge lead lists without opening a dozen browser tabs.

---

## 1. What problem does it solve?

- **Instant prioritisation:** Upload the CSV you already have and get back a ranked list of leads within minutes.
- **Automatic research:** The app checks a company’s website and Google reviews so humans don’t have to.
- **Actionable storytelling:** Every score includes a plain-language explanation so reps know why a lead is “Hot” or “Cold”.
- **Audit-friendly history:** When you choose to, results are stored in Supabase so runs can be reviewed later.

---

## 2. How does it work? (Simple flow)

1. **Upload a CSV** – The dashboard accepts comma or semicolon separated files and cleans up messy headers automatically.
2. **Optional clean-up** – An AI helper fixes odd company names, domains, and locations so each record is consistent.
3. **Enrichment** – The system grabs basic website information and Google Maps ratings/review counts to build extra context.
4. **Scoring** – GPT‑5 (via OpenRouter) rates each lead across five factors, we double-check the math, and generate a final score plus interpretation (Hot, Qualified, Borderline, Cold Dead).
5. **Review & export** – See the results instantly in the table, save them to Supabase, or download the enhanced CSV for your CRM.

Large uploads (roughly 150+ rows) are handed to a background worker so your browser stays responsive while the batch finishes.

---

## 3. Architecture in plain English

- **Next.js + React frontend** – Provides the login page, dashboard, CSV upload wizard, and tables. Everything lives under `src/app`.
- **Server routes** – Files inside `src/app/api/**` act like mini back-end endpoints. They handle scoring requests, enqueue long-running jobs, and save finished runs to Supabase.
- **Scoring brain** – `src/lib/scoreLeads.ts` is the shared engine that cleans each row, enriches it, talks to the AI model, and returns a structured result. Both the API route and the background worker call into this one file so the logic stays in sync.
- **Background job helper** – `src/lib/jobQueue.ts` keeps track of big jobs in memory, processes a few leads at a time, and lets the frontend poll for progress. (For production scale you’ll want to swap this for a durable queue—see Deployment tips.)
- **Supabase** – Plays three roles: authentication (email/password), storage for finished lead runs, and housing the service-role key the server uses when saving data.
- **External services** – OpenRouter for GPT‑5 scoring, fetch/Puppeteer for website and Google Maps data.

---

## 4. Technology cheat sheet

| Piece | What it does |
| --- | --- |
| **Next.js 15 / React 19** | Modern UI framework powering the dashboard and API routes. |
| **TypeScript** | Adds type safety and better editor support. |
| **Tailwind CSS v4** | Utility classes for consistent styling without writing lots of custom CSS. |
| **Supabase** | Provides Postgres, Auth, and an easy JS client. |
| **OpenRouter (GPT‑5)** | The language model that evaluates each lead. |
| **Puppeteer / fetch** | Used when we need to load a site or Google Maps page behind the scenes. |
| **pnpm + ESLint** | Package management and linting for a tidy codebase. |

---

## 5. Key features (non-developer speak)

- **Mess-proof CSV importer** – Handles mixed delimiters, quotes, and missing IDs.
- **AI clean-up button** – Switch it on if the spreadsheet is messy; switch it off if you already trust the data.
- **Website & review insights** – Quickly shows whether a company has social proof or an active site.
- **Explainable scores** – Every lead has a “View reasoning” toggle with clear sentences, plus the raw JSON for power users.
- **Progress feedback** – Large files show a live counter (e.g., “Processing job 1234… 220/500 leads completed”).
- **Dark mode toggle** – Because staring at bright tables all day hurts.

---

## 6. Recent improvements worth noting

1. Rebranded the entire experience to **Lead Score Genius** (UI, metadata, docs, API headers).
2. Normalised reasoning output so React never crashes when the AI returns JSON instead of text.
3. Added resilient fallbacks when website scraping, reviews, or the AI call fail mid-run.
4. Extracted the scoring logic into a single helper and introduced the async job queue for large CSVs.
5. Expanded docs (PRD, ADR, project structure) to match the new architecture.

---

## 7. Getting started locally (step by step)

1. **Install dependencies**
   ```bash
   pnpm install
   ```
2. **Create a `.env.local` file** (copy the template below) and fill in your Supabase + OpenRouter credentials.
3. **Run the dev server**
   ```bash
   pnpm dev
   ```
   Visit `http://localhost:3000` and sign up with any email/password.
4. **Lint when you change code**
   ```bash
   pnpm lint
   ```

---

## 8. Environment variables (what they mean)

| Name | Where it’s used | Why it matters |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Frontend + server | Points the app at your Supabase project. |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Frontend | Allows the browser to talk to Supabase Auth. |
| `SUPABASE_SERVICE_ROLE_KEY` | Server only | Lets the server save lead runs securely. |
| `OPENROUTER_API_KEY` | Server only | Auth token for the GPT‑5 model. |
| `OPENROUTER_BASE_URL` & `OPENROUTER_MODEL` | Server | Configure which model endpoint to call. |
| `MAPS_TIMEOUT_MS` | Server | How long to wait when fetching websites / Google Maps before timing out. |
| `MAX_CONCURRENCY` (optional) | Server | Caps how many leads are processed at once. |

Keep secrets out of Git—`.env.local` is already ignored.

---

## 9. Deployment tips (Vercel + Supabase)

1. Set up a Supabase project and run the SQL in `supabase/migrations` and `supabase/policies.sql`.
2. Add the environment variables above to both Vercel (project settings → Environment Variables) and Supabase (Auth redirect URLs, storage bucket if needed).
3. Push the repo to GitHub, connect it to Vercel, and deploy. Vercel handles builds with `pnpm install` + `pnpm build`.
4. Before onboarding large teams, replace the in-memory queue with a durable worker (Supabase Edge Function, pgmq, or another hosted queue) so long jobs survive restarts.

---

## 10. Roadmap ideas

- Swap the in-memory queue for a persistent job service.
- Add email or in-app notifications when a long job finishes.
- Surface per-lead warnings (“website timed out”, “no reviews found”) with filters.
- Allow admins to tweak scoring weights from the UI.
- Add charts and saved-job history using Supabase data.

---

## 11. Repository hygiene checklist

- Run `pnpm lint` before committing.
- Update `docs/ADR.md`, `docs/PRD.md`, and `docs/PROJECT_STRUCTURE.md` whenever architecture or scope changes.
- Keep `src/lib/scoreLeads.ts` and related types in sync when adding new factors or enrichment sources.

That’s it! With the README above, anyone—technical or not—should understand what Lead Score Genius does, how it works behind the scenes, and how to get it running.
