# Product Requirements Document (PRD)

## Overview
Lead Score Genius is a lightweight web application that enables revenue teams to transform raw lead lists into prioritized queues. Users upload CSV exports from their CRM or marketing automation tools and receive immediate scoring, health classification, and recommended next actions without leaving the browser.

## Goals
- Provide an intuitive CSV upload experience that works with common CRM exports.
- Calculate a blended lead score combining firmographic fit, engagement, and recency signals.
- Surface actionable insights (health tier and recommended action) alongside the scored data.
- Allow users to download an enriched CSV for re-importing into downstream systems.
- Automate the research workflow by delegating scoring logic to GPT-5 via OpenRouter while preserving deterministic weighting.
- Enrich lead context by scraping Google Maps listings for review count and rating data.

## Primary Users
- **Revenue Operations (RevOps)** professionals who evaluate pipeline quality and feed back to sales reps.
- **Account Executives & SDRs** who need a prioritized list of leads to engage.
- **Growth/Marketing Ops** teams who experiment with scoring models before codifying them in a CRM.

## User Stories
- As a RevOps analyst, I can upload a CSV of leads so that I receive scored entries I can share with my sales team.
- As an SDR, I can review health tiers and recommended actions so that I know how to follow up with each lead.
- As a marketing manager, I can download the enriched CSV so that I can re-import scores back into our CRM.
- As a product owner, I can adjust the scoring heuristics in code so that new signals can be incorporated quickly.

## Current Scope
- Client-side CSV parsing that supports comma and semicolon delimiters plus quoted values.
- Server-side lead scoring orchestration that calls the OpenRouter GPT-5 model with the detailed weighting matrix.
- Background-friendly job queue that processes large CSV uploads asynchronously while streaming progress back to the dashboard.
- Automated Google Maps scraping to capture average rating and review counts for each lead.
- On-screen summary metrics for total leads, average score, and interpretation distribution.
- Download of the enriched dataset with appended final score, interpretation, and individual factor scores.
- Optional Supabase persistence for storing scored runs, reasoning, and enrichment metadata.

## Out of Scope (for now)
- Authentication and multi-user workspaces.
- Customizable scoring weights via the UI.
- Real-time collaboration or commenting on leads.
- Long-running job orchestration and queue monitoring.

## Success Metrics
- Time-to-first-score (upload → scored output) under 5 seconds for standard CSV exports (<5k rows).
- Zero parsing errors for well-formed CSV files from HubSpot, Salesforce, or Outreach.
- At least 80% of users report that recommended actions are directionally useful during pilot tests.

## Future Enhancements
- Persist scored runs and GPT reasoning in Supabase for auditability and trend analysis.
- Add Supabase edge functions to offload long-running scraping or scoring batches.
- Introduce authentication (Supabase Auth) so teams can manage saved scoring templates.
- Provide visualization dashboards (trends by interpretation band, top cited signals) on top of Supabase data.
