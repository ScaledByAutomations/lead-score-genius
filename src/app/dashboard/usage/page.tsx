"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { DashboardNav } from "@/components/DashboardNav";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type UsageByDay = {
  date: string;
  cleaning: number;
  scoring: number;
};

type UsageJobRow = {
  id: string;
  status: string;
  total: number;
  processed: number;
  createdAt: number;
  updatedAt: number;
  tokens: {
    cleaning: number;
    scoring: number;
    total: number;
  };
  userId: string | null;
};

type UsageApiResponse = {
  usageByDay: UsageByDay[];
  jobs: UsageJobRow[];
  totals: {
    cleaning: number;
    scoring: number;
  };
};

const toInputDate = (value: Date) => value.toISOString().slice(0, 10);

const formatTokens = (value: number) => value.toLocaleString();

const STATUS_OPTIONS: Array<{ label: string; value: string }> = [
  { label: "All statuses", value: "" },
  { label: "Pending", value: "queued" },
  { label: "Processing", value: "processing" },
  { label: "Completed", value: "completed" },
  { label: "Failed", value: "failed" }
];

const ACTIVE_JOB_STORAGE_KEY = "lead-score-genius-active-job-id";
const ACTIVE_JOB_OPTIONS_KEY = "lead-score-genius-active-job-options";

export default function UsageDashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const today = useMemo(() => new Date(), []);
  const sevenDaysAgo = useMemo(() => new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);

  const [startDate, setStartDate] = useState<string>(toInputDate(sevenDaysAgo));
  const [endDate, setEndDate] = useState<string>(toInputDate(today));
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [usageByDay, setUsageByDay] = useState<UsageByDay[]>([]);
  const [jobs, setJobs] = useState<UsageJobRow[]>([]);
  const [totals, setTotals] = useState<{ cleaning: number; scoring: number }>({ cleaning: 0, scoring: 0 });

  useEffect(() => {
    let cancelled = false;

    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) {
        return;
      }
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

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    if (typeof window !== "undefined") {
      window.localStorage.removeItem(ACTIVE_JOB_STORAGE_KEY);
      window.localStorage.removeItem(ACTIVE_JOB_OPTIONS_KEY);
    }
    router.replace("/");
  }, [router, supabase]);

  const fetchUsage = useCallback(async () => {
    if (!currentUserId) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (startDate) params.set("start", startDate);
      if (endDate) params.set("end", endDate);
      if (status) params.set("status", status);
      params.set("user_id", currentUserId);

      const response = await fetch(`/api/usage?${params.toString()}`);
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload?.error ?? "Failed to load usage data.");
      }

      const json = (await response.json()) as UsageApiResponse;
      setUsageByDay(json.usageByDay);
      setJobs(json.jobs);
      setTotals(json.totals);
    } catch (usageError) {
      setError(usageError instanceof Error ? usageError.message : "Failed to load usage data.");
    } finally {
      setLoading(false);
    }
  }, [currentUserId, endDate, startDate, status]);

  useEffect(() => {
    if (!authChecked || !currentUserId) {
      return;
    }
    void fetchUsage();
  }, [authChecked, currentUserId, fetchUsage]);

  const maxTokens = useMemo(() => {
    return usageByDay.reduce((acc, day) => Math.max(acc, day.cleaning + day.scoring), 0);
  }, [usageByDay]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)] transition-colors">
        <p className="text-sm text-[var(--muted)]">Checking authentication…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] transition-colors">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="space-y-4">
          <div className="flex justify-end">
            <DashboardNav onSignOut={handleSignOut}>
              {currentEmail ? (
                <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs text-[var(--muted)]">
                  Signed in as {currentEmail}
                </span>
              ) : null}
            </DashboardNav>
          </div>
          <div className="space-y-2">
            <h1 className="text-3xl font-semibold text-[var(--foreground)]">Token Usage</h1>
            <p className="text-sm text-[var(--muted)]">
              Track OpenRouter tokens by day and job. Adjust filters to limit the time range or focus on specific jobs.
            </p>
          </div>
        </header>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3">
            <label className="flex flex-col gap-2 text-xs text-[var(--muted)]">
              Start date
              <input
                type="date"
                value={startDate}
                max={endDate}
                onChange={(event) => setStartDate(event.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)]"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs text-[var(--muted)]">
              End date
              <input
                type="date"
                value={endDate}
                min={startDate}
                onChange={(event) => setEndDate(event.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)]"
              />
            </label>
            <label className="flex flex-col gap-2 text-xs text-[var(--muted)]">
              Job status
              <select
                value={status}
                onChange={(event) => setStatus(event.target.value)}
                className="rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] px-3 py-2 text-sm text-[var(--foreground)]"
              >
                {STATUS_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => void fetchUsage()}
              className="rounded-md border border-[var(--accent)] bg-[var(--accent)] px-3 py-1.5 text-sm font-medium text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            >
              Refresh
            </button>
            <span className="text-xs text-[var(--muted)]">
              Cleaning tokens: {formatTokens(totals.cleaning)} · Scoring tokens: {formatTokens(totals.scoring)}
            </span>
          </div>
        </section>

        {error ? (
          <section className="rounded-lg border border-[color:var(--error)] bg-[color:var(--error)]/10 p-4 text-sm text-[color:var(--error)]">
            {error}
          </section>
        ) : null}

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Usage by day</h2>
          {loading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">Loading usage…</p>
          ) : usageByDay.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">No token usage recorded for the selected range.</p>
          ) : (
            <div className="mt-4 space-y-3">
              {usageByDay.map((day) => {
                const total = day.cleaning + day.scoring;
                const width = maxTokens > 0 ? Math.max((total / maxTokens) * 100, 4) : 4;
                return (
                  <div key={day.date} className="space-y-1">
                    <div className="flex items-center justify-between text-xs text-[var(--muted)]">
                      <span>{day.date}</span>
                      <span>
                        Cleaning {formatTokens(day.cleaning)} · Scoring {formatTokens(day.scoring)}
                      </span>
                    </div>
                    <div className="relative h-3 overflow-hidden rounded-full bg-[var(--surface-subtle)]">
                      <div
                        className="absolute inset-y-0 left-0 bg-[color:var(--accent)]"
                        style={{ width: `${Math.max((day.cleaning / (total || 1)) * 100, 0)}%` }}
                      />
                      <div
                        className="absolute inset-y-0 bg-[color:var(--warning)]"
                        style={{
                          width: `${width}%`,
                          left: `${Math.max((day.cleaning / (maxTokens || 1)) * 100, 0)}%`
                        }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Recent jobs</h2>
          {loading ? (
            <p className="mt-4 text-sm text-[var(--muted)]">Loading jobs…</p>
          ) : jobs.length === 0 ? (
            <p className="mt-4 text-sm text-[var(--muted)]">No jobs found for the selected filter.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="mt-4 min-w-full divide-y divide-[var(--border-muted)] text-left text-sm">
                <thead className="bg-[var(--surface-subtle)] text-xs uppercase text-[var(--muted)]">
                  <tr>
                    <th className="px-4 py-3 font-medium">Job</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Progress</th>
                    <th className="px-4 py-3 font-medium">Tokens</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-muted)]">
                  {jobs.map((job) => (
                    <tr key={job.id}>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        <p className="font-medium text-[var(--foreground)]">{job.id.slice(0, 8)}</p>
                        <p>Started {new Date(job.createdAt).toLocaleString()}</p>
                        <p>Updated {new Date(job.updatedAt).toLocaleString()}</p>
                        {job.userId ? <p>User {job.userId}</p> : null}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">{job.status}</td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        {job.processed}/{job.total}
                      </td>
                      <td className="px-4 py-3 text-xs text-[var(--muted)]">
                        <p>Total {formatTokens(job.tokens.total)}</p>
                        <p>Cleaning {formatTokens(job.tokens.cleaning)}</p>
                        <p>Scoring {formatTokens(job.tokens.scoring)}</p>
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
