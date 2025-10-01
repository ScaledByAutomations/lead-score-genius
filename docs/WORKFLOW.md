# Workflow Guide

This repository is maintained inside the V0 environment and must preserve architectural discipline. Follow the steps below every time you make a change.

## Daily Flow
1. **Plan**: Review open tasks, capture acceptance criteria, and outline your approach.
2. **Update Docs First**: Check `/docs/PRD.md` and `/docs/ADR.md` for relevant context. Add planned changes or new decisions before touching code when possible.
3. **Implement**: Make code or schema changes while keeping the documented architecture in mind.
4. **Validate**: Run lint/tests relevant to your change (e.g., `pnpm lint`, Supabase migrations).
5. **Document**: Update the following before finalizing work:
   - `/docs/PRD.md` – reflect new product requirements or user stories affected.
   - `/docs/ADR.md` – record any architectural or tooling decisions made.
   - `/docs/PROJECT_STRUCTURE.md` – regenerate the structure section if files were added/removed.
   - `/docs/WORKFLOW.md` – adjust the process itself if it evolves.
6. **Communicate**: Summarize changes, highlight verification steps, and note follow-ups.

## Checklist (run on every task)
- [ ] Reviewed existing PRD and ADR context.
- [ ] Documented new requirements or decisions in PRD/ADR.
- [ ] Updated project structure diagram if filesystem changed.
- [ ] Ran lint/tests applicable to the change.
- [ ] Described workflow or process updates when relevant.
- [ ] Confirmed Supabase assets (migrations/policies/functions) stay organized if touched.
- [ ] Verified `.env.local` includes required third-party keys (e.g., `OPENROUTER_API_KEY`, `MAPS_HEADLESS`, `AI_CLEANER_ENABLED`).

Adhering to this workflow keeps the Next.js + Supabase stack maintainable and auditable as the product scales.
