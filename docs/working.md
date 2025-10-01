# Working Baseline (Birdie Issue Outstanding)

This document captures the current "known good" behavior after reverting recent experiments on the Google Maps review resolver.

## Snapshot

- Leads with valid `/maps/place` URLs or resolvable SERP results still return ratings and review counts.
- The fallback path (`fetchViaJina`) once again accepts the first `"★ (...)"` match in the scraped text without extra filtering.
- Because of that, Birdie Getz Financial is misattributing reviews from a different listing, while the other sample leads continue to work.

## Why we rolled back

- Tight matching logic was over-filtering, causing every lead to return `Not found`.
- The rollback restores functionality for all other leads, keeping only the Birdie mismatch as the remaining known bug.

## Next Steps (Open)

1. Design a fix that targets the Jina fallback only (e.g., scoring candidates or verifying against company-specific tokens) without disrupting successfully resolved leads.
2. Add regression coverage once a robust heuristic is in place so future changes do not reintroduce the global failure mode.

> Use this doc as the baseline reference until the Birdie Getz review issue is solved.

