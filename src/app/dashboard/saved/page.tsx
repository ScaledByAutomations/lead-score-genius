"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/ThemeToggle";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type LeadRun = {
  id: string;
  lead_id: string;
  company: string;
  industry: string | null;
  final_score: number;
  interpretation: string;
  created_at: string;
  scores: Record<string, unknown> | null;
  enriched: Record<string, unknown> | null;
};

const INTERPRETATION_OPTIONS = ["All", "Hot", "Qualified", "Borderline", "Cold Dead"] as const;

export default function SavedLeadsPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [leadRuns, setLeadRuns] = useState<LeadRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [searchTerm, setSearchTerm] = useState("");
  const [interpretationFilter, setInterpretationFilter] = useState<(typeof INTERPRETATION_OPTIONS)[number]>("All");
  const [industryFilter, setIndustryFilter] = useState("All");
  const [minScore, setMinScore] = useState(0);
  const [maxScore, setMaxScore] = useState(10);

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      const session = data.session;
      if (!session) {
        router.replace("/");
        return;
      }
      setCurrentEmail(session.user.email ?? null);
      setCurrentUserId(session.user.id ?? null);
      setAuthChecked(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setAuthChecked(false);
        setCurrentEmail(null);
        setCurrentUserId(null);
        router.replace("/");
        return;
      }
      setCurrentEmail(session.user.email ?? null);
      setCurrentUserId(session.user.id ?? null);
      setAuthChecked(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const fetchLeadRuns = useCallback(async () => {
    if (!currentUserId) {
      setLeadRuns([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/lead-runs?user_id=${encodeURIComponent(currentUserId)}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to load saved leads");
      }
      const payload = (await response.json()) as { leads: LeadRun[] };
      setLeadRuns(payload.leads ?? []);
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Failed to load saved leads");
    } finally {
      setLoading(false);
    }
  }, [currentUserId]);

  useEffect(() => {
    if (!authChecked || !currentUserId) {
      return;
    }
    fetchLeadRuns();
  }, [authChecked, currentUserId, fetchLeadRuns]);

  const industries = useMemo(() => {
    const unique = new Set<string>();
    leadRuns.forEach((run) => {
      if (run.industry) {
        unique.add(run.industry);
      }
    });
    return ["All", ...Array.from(unique).sort((a, b) => a.localeCompare(b))];
  }, [leadRuns]);

  const filteredLeads = useMemo(() => {
    return leadRuns.filter((run) => {
      if (interpretationFilter !== "All" && run.interpretation !== interpretationFilter) {
        return false;
      }
      if (industryFilter !== "All" && run.industry !== industryFilter) {
        return false;
      }
      if (run.final_score < minScore || run.final_score > maxScore) {
        return false;
      }
      if (searchTerm) {
        const term = searchTerm.toLowerCase();
        if (
          ![
            run.company,
            run.industry ?? "",
            run.interpretation,
            run.lead_id
          ]
            .join(" ")
            .toLowerCase()
            .includes(term)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [industryFilter, interpretationFilter, leadRuns, maxScore, minScore, searchTerm]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)] transition-colors">
        <p className="text-sm text-[var(--muted)]">Checking authentication…</p>
      </div>
    );
  }

  const busyButton = "cursor-progress border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]";
  const secondaryButton = "border border-[var(--border)] bg-[var(--surface)] text-[var(--foreground)] shadow-sm hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] transition-colors">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <main className="mx-auto flex max-w-6xl flex-col gap-8 px-6 py-10">
        <header className="space-y-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-3xl font-semibold">Saved lead runs</h1>
              <p className="text-sm text-[var(--muted)]">
                Review and filter the leads you’ve persisted to Supabase.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
              <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
                Signed in as {currentEmail}
              </span>
              <a
                href="/dashboard"
                className={`rounded-md border px-3 py-1 text-[var(--foreground)] ${secondaryButton}`}
              >
                Back to scoring
              </a>
              <button
                type="button"
                onClick={fetchLeadRuns}
                className={`rounded-md border px-3 py-1 text-[var(--foreground)] ${loading ? busyButton : secondaryButton}`}
              >
                {loading ? "Refreshing…" : "Refresh"}
              </button>
            </div>
          </div>
        </header>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs uppercase text-[var(--muted)]">Search</label>
              <input
                type="search"
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="Company, industry, interpretation"
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-[var(--muted)]">Interpretation</label>
              <select
                value={interpretationFilter}
                onChange={(event) => setInterpretationFilter(event.target.value as typeof INTERPRETATION_OPTIONS[number])}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
              >
                {INTERPRETATION_OPTIONS.map((option) => (
                  <option
                    key={option}
                    value={option}
                  >
                    {option === "All" ? "All interpretations" : option}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-[var(--muted)]">Industry</label>
              <select
                value={industryFilter}
                onChange={(event) => setIndustryFilter(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
              >
                {industries.map((industryOption) => (
                  <option key={industryOption} value={industryOption}>
                    {industryOption === "All" ? "All industries" : industryOption}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-xs uppercase text-[var(--muted)]">Score range</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={minScore}
                  onChange={(event) => setMinScore(Number(event.target.value))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                />
                <span className="text-xs text-[var(--muted)]">to</span>
                <input
                  type="number"
                  min={0}
                  max={10}
                  step={0.1}
                  value={maxScore}
                  onChange={(event) => setMaxScore(Number(event.target.value))}
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                />
              </div>
            </div>
          </div>
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          {error ? (
            <p className="text-sm" style={{ color: "var(--error)" }}>
              {error}
            </p>
          ) : null}

          {loading ? (
            <p className="text-sm text-[var(--muted)]">Loading saved leads…</p>
          ) : filteredLeads.length === 0 ? (
            <div className="space-y-3 text-sm text-[var(--muted)]">
              <p>No saved leads found for the selected filters.</p>
              <ul className="list-disc space-y-1 pl-5">
                <li>Adjust the filters or clear the search term.</li>
                <li>Run the scoring workflow and save results to populate this view.</li>
              </ul>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[var(--border-muted)] text-left text-sm">
                <thead className="bg-[var(--surface-subtle)] text-xs uppercase text-[var(--muted)]">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">Company</th>
                    <th scope="col" className="px-4 py-3 font-medium">Industry</th>
                    <th scope="col" className="px-4 py-3 font-medium">Final score</th>
                    <th scope="col" className="px-4 py-3 font-medium">Interpretation</th>
                    <th scope="col" className="px-4 py-3 font-medium">Recorded</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-muted)]">
                  {filteredLeads.map((run) => (
                    <tr key={run.id} className="align-top">
                      <td className="px-4 py-3 text-[var(--muted)]">
                        <p className="font-medium text-[var(--foreground)]">{run.company}</p>
                        <p className="text-xs text-[var(--muted)]">Lead ID: {run.lead_id}</p>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">{run.industry ?? "—"}</td>
                      <td className="px-4 py-3 text-[var(--muted)]">{run.final_score.toFixed(2)}</td>
                      <td className="px-4 py-3">
                        <span className="rounded-full border border-[var(--border)] bg-[var(--surface-subtle)] px-2 py-0.5 text-xs font-medium text-[var(--muted-strong)]">
                          {run.interpretation}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-[var(--muted)]">
                        {new Date(run.created_at).toLocaleString()}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
