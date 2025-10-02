"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import type { LeadInput, LeadScoreApiResponse, LeadScoreResponse } from "@/lib/types";
import { ThemeToggle } from "@/components/ThemeToggle";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

type ParsedLead = Record<string, string>;

type JobStatus = "pending" | "processing" | "completed" | "failed";

type JobSnapshot = {
  id: string;
  status: JobStatus;
  total: number;
  processed: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  supabase: LeadScoreApiResponse["supabase"];
  results: LeadScoreApiResponse["leads"];
};

const ASYNC_JOB_THRESHOLD = 150;

const FIELD_ALIASES = {
  id: ["id", "lead_id", "record_id", "crm_id"],
  company: ["company", "company_name", "account", "account_name", "organization", "business_name"],
  industry: ["industry", "vertical", "segment"],
  website: ["website", "website_url", "url"],
  email: ["email", "email_address"],
  contact: ["contact", "contact_name", "name", "full_name", "lead_name"],
  city: ["city", "locality"],
  state: ["state", "region", "province"],
  country: ["country"],
  notes: ["notes", "description", "summary"]
} satisfies Record<string, string[]>;

const FALLBACK_HEADERS = {
  id: "lead_id",
  company: "company"
};

function normalizeKey(input: string, index: number): string {
  const cleaned = input.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return cleaned === "" ? `column_${index + 1}` : cleaned;
}

function detectDelimiter(sampleLine: string): string {
  const commaCount = (sampleLine.match(/,/g) ?? []).length;
  const semicolonCount = (sampleLine.match(/;/g) ?? []).length;
  return semicolonCount > commaCount ? ";" : ",";
}

function parseCsv(content: string): {
  originalHeaders: string[];
  normalizedHeaders: string[];
  normalizedRows: ParsedLead[];
  originalRows: Record<string, string>[];
} {
  const normalizedText = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const lines = normalizedText.split("\n");
  const headerLine = lines[0] ?? "";
  const delimiter = detectDelimiter(headerLine);

  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < normalizedText.length; i += 1) {
    const char = normalizedText[i];
    const nextChar = normalizedText[i + 1];

    if (char === "\n" && !inQuotes) {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    if (char === "\"") {
      if (inQuotes && nextChar === "\"") {
        cell += "\"";
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }

    if (char === delimiter && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows.length === 0) {
    return { originalHeaders: [], normalizedHeaders: [], normalizedRows: [], originalRows: [] };
  }

  const rawHeaders = rows[0].map((header, index) => {
    const trimmed = header.trim();
    return trimmed === "" ? `Column ${index + 1}` : trimmed;
  });

  const normalizedHeaders = rawHeaders.map(normalizeKey);
  const bodyRows = rows.slice(1).filter((cells) => cells.some((value) => value.trim() !== ""));

  const normalizedRows: ParsedLead[] = [];
  const originalRows: Record<string, string>[] = [];

  bodyRows.forEach((cells) => {
    const normalizedRecord: ParsedLead = {};
    const originalRecord: Record<string, string> = {};

    rawHeaders.forEach((header, index) => {
      const normalizedHeader = normalizedHeaders[index];
      const value = (cells[index] ?? "").trim();
      normalizedRecord[normalizedHeader] = value;
      originalRecord[header] = value;
    });

    normalizedRows.push(normalizedRecord);
    originalRows.push(originalRecord);
  });

  return {
    originalHeaders: rawHeaders,
    normalizedHeaders,
    normalizedRows,
    originalRows
  };
}

function getValue(record: ParsedLead, aliases: string[]): string | undefined {
  for (const key of aliases) {
    const value = record[key];
    if (value) {
      return value;
    }
  }
  return undefined;
}

function buildLocation(record: ParsedLead): string | undefined {
  const parts = [
    getValue(record, FIELD_ALIASES.city),
    getValue(record, FIELD_ALIASES.state),
    getValue(record, FIELD_ALIASES.country),
    record.location,
    record.address
  ]
    .map((value) => value?.trim())
    .filter(Boolean);

  if (parts.length === 0) {
    return undefined;
  }

  return Array.from(new Set(parts)).join(", ");
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes("\n") || value.includes("\"")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function formatWeight(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value.toFixed(2);
  }
  if (typeof value === "string" && value.trim() !== "") {
    return value;
  }
  return "—";
}

export default function DashboardPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scoredLeads, setScoredLeads] = useState<LeadScoreApiResponse["leads"]>([]);
  const [originalHeaders, setOriginalHeaders] = useState<string[]>([]);
  const [originalRows, setOriginalRows] = useState<Record<string, string>[]>([]);
  const [pendingLeads, setPendingLeads] = useState<LeadInput[]>([]);
  const [useCleaner, setUseCleaner] = useState(true);
  const [supabaseStatus, setSupabaseStatus] = useState<"unknown" | "connected" | "missing" | "error">("unknown");
  const [supabaseReason, setSupabaseReason] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [autoSaveToSupabase, setAutoSaveToSupabase] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<JobSnapshot | null>(null);

  const statusBadgeClass = useMemo(() => {
    switch (supabaseStatus) {
      case "connected":
        return "border border-[color:var(--success)] bg-[color:var(--success)]/10 text-[color:var(--success)]";
      case "missing":
        return "border border-[color:var(--warning)] bg-[color:var(--warning)]/10 text-[color:var(--warning)]";
      case "error":
        return "border border-[color:var(--error)] bg-[color:var(--error)]/10 text-[color:var(--error)]";
      default:
        return "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]";
    }
  }, [supabaseStatus]);

  const saveButtonClass = useMemo(() => {
    const base = "rounded-md border px-3 py-1.5 text-sm font-medium transition";
    if (saveState === "saving") {
      return `${base} cursor-progress border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]`;
    }
    switch (supabaseStatus) {
      case "connected":
        return `${base} border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]`;
      case "error":
        return `${base} border border-[color:var(--error)] bg-[color:var(--error)] text-[var(--accent-contrast)] hover:bg-[color-mix(in_oklab,var(--error) 80%,white 20%)]`;
      case "missing":
        return `${base} border border-[color:var(--warning)] bg-[color:var(--warning)] text-[var(--accent-contrast)] hover:bg-[color-mix(in_oklab,var(--warning) 80%,white 20%)]`;
      default:
        return `${base} border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]`;
    }
  }, [saveState, supabaseStatus]);

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
      setCurrentUserEmail(session.user.email ?? null);
      setCurrentUserId(session.user.id ?? null);
      setAuthChecked(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setAuthChecked(false);
        setCurrentUserEmail(null);
        router.replace("/");
        return;
      }
      setCurrentUserEmail(session.user.email ?? null);
      setCurrentUserId(session.user.id ?? null);
      setAuthChecked(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  useEffect(() => {
    let cancelled = false;
    const checkSupabase = async () => {
      try {
        const response = await fetch("/api/save", { method: "GET" });
        if (!response.ok) {
          throw new Error("Request failed");
        }
        const data = await response.json();
        if (cancelled) {
          return;
        }
        setSupabaseStatus(data.available ? "connected" : "missing");
        setSupabaseReason(data.available ? null : data.reason ?? null);
      } catch (statusError) {
        if (!cancelled) {
          console.error(statusError);
          setSupabaseStatus("error");
          setSupabaseReason(statusError instanceof Error ? statusError.message : String(statusError));
        }
      }
    };

    checkSupabase();

    return () => {
      cancelled = true;
    };
  }, [useCleaner]);

  useEffect(() => {
    if (supabaseStatus !== "connected" && autoSaveToSupabase) {
      setAutoSaveToSupabase(false);
    }
  }, [supabaseStatus, autoSaveToSupabase]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    setAuthChecked(false);
    setCurrentUserEmail(null);
    setCurrentUserId(null);
    setAutoSaveToSupabase(false);
    router.replace("/");
  }, [router, supabase]);

  const handleDownload = useCallback(() => {
    if (scoredLeads.length === 0) {
      return;
    }

    const appendedHeaders = [
      "lead_score",
      "lead_interpretation",
      "website_activity_score",
      "reviews_score",
      "years_in_business_score",
      "revenue_proxies_score",
      "industry_fit_score"
    ];

    const headers = [...originalHeaders, ...appendedHeaders];
    const rows = [headers.map(escapeCsv).join(",")];

    scoredLeads.forEach(({ score }, index) => {
      const original = originalRows[index] ?? {};
      const originalValues = originalHeaders.map((header) => escapeCsv(original[header] ?? ""));

      const additions = [
        escapeCsv(String(score.final_score)),
        escapeCsv(score.interpretation),
        escapeCsv(String(score.scores.website_activity)),
        escapeCsv(String(score.scores.reviews.score)),
        escapeCsv(String(score.scores.years_in_business)),
        escapeCsv(String(score.scores.revenue_proxies)),
        escapeCsv(String(score.scores.industry_fit))
      ];

      rows.push([...originalValues, ...additions].join(","));
    });

    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const downloadName = fileName ? fileName.replace(/\.csv$/i, "") : "scored-leads";

    const link = document.createElement("a");
    link.href = url;
    link.download = `${downloadName}-scored.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [fileName, originalHeaders, originalRows, scoredLeads]);

  const handleSaveToSupabase = useCallback(async () => {
    if (scoredLeads.length === 0) {
      return;
    }
    setSaveState("saving");
    setSaveError(null);

    try {
      const response = await fetch("/api/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          leads: scoredLeads,
          user_id: currentUserId ?? undefined
        })
      });

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data?.error ?? "Failed to save results");
      }

      setSaveState("saved");
    } catch (saveErr) {
      setSaveState("error");
      setSaveError(saveErr instanceof Error ? saveErr.message : "Save failed");
    }
  }, [currentUserId, scoredLeads]);

  const handleFileUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    setError(null);
    setScoredLeads([]);
    setPendingLeads([]);
    setSaveState("idle");
    setSaveError(null);
    setProcessing(false);

    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = String(reader.result ?? "");
        const parsed = parseCsv(text);

        if (parsed.normalizedRows.length === 0) {
          setError("No data rows detected in the CSV file.");
          setOriginalHeaders([]);
          setOriginalRows([]);
          return;
        }

        const leadInputs: LeadInput[] = parsed.normalizedRows.map((record, index) => ({
          lead_id:
            getValue(record, FIELD_ALIASES.id) ??
            record[FALLBACK_HEADERS.id] ??
            `lead_${index + 1}`,
          company:
            getValue(record, FIELD_ALIASES.company) ??
            record[FALLBACK_HEADERS.company] ??
            "Unknown company",
          industry: getValue(record, FIELD_ALIASES.industry) ?? "default",
          website: getValue(record, FIELD_ALIASES.website),
          location: buildLocation(record),
          notes: getValue(record, FIELD_ALIASES.notes),
          normalized: record
        }));

        setPendingLeads(leadInputs);
        setOriginalHeaders(parsed.originalHeaders);
        setOriginalRows(parsed.originalRows);
        setFileName(file.name);
      } catch (uploadError) {
        setError(uploadError instanceof Error ? uploadError.message : "Unable to process file.");
        setPendingLeads([]);
        setOriginalHeaders([]);
        setOriginalRows([]);
      }
    };

    reader.onerror = () => {
      setError("Failed to read the selected file.");
      setPendingLeads([]);
      setOriginalHeaders([]);
      setOriginalRows([]);
    };

    reader.readAsText(file);
  }, []);

  const handleScoreLeads = useCallback(async () => {
    if (pendingLeads.length === 0) {
      setError("Upload a CSV before scoring.");
      return;
    }

    setProcessing(true);
    setError(null);
    setActiveJob(null);
    setJobId(null);
    const willAutoSave = autoSaveToSupabase && supabaseStatus === "connected";
    if (willAutoSave) {
      setSaveState("saving");
      setSaveError(null);
    } else {
      setSaveState("idle");
      setSaveError(null);
    }

    const payload = {
      leads: pendingLeads,
      options: {
        useCleaner,
        saveToSupabase: willAutoSave
      },
      user_id: currentUserId ?? undefined
    };

    const useAsyncJob = pendingLeads.length >= ASYNC_JOB_THRESHOLD;

    try {
      if (useAsyncJob) {
        const response = await fetch("/api/score-leads/enqueue", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify(payload)
        });

        if (!response.ok) {
          const message = await response.json().catch(() => ({}));
          throw new Error(message?.error ?? "Failed to enqueue scoring job.");
        }

        const data = (await response.json()) as { job: JobSnapshot };
        setJobId(data.job.id);
        setActiveJob(data.job);
        setScoredLeads(data.job.results ?? []);
        return;
      }

      const response = await fetch("/api/score-leads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        const message = await response.json().catch(() => ({}));
        throw new Error(message?.error ?? "Failed to score leads.");
      }

      const json = (await response.json()) as LeadScoreApiResponse;

      setScoredLeads(json.leads);
      setActiveJob(null);
      setJobId(null);
      if (json.supabase?.requested) {
        if (json.supabase.saved) {
          setSaveState("saved");
          setSaveError(null);
        } else {
          setSaveState("error");
          setSaveError(json.supabase.error ?? "Failed to save to Supabase.");
        }
      } else if (!willAutoSave) {
        setSaveState("idle");
        setSaveError(null);
      }
    } catch (scoreError) {
      setError(scoreError instanceof Error ? scoreError.message : "Failed to score leads.");
      if (willAutoSave) {
        setSaveState("error");
        setSaveError("Scoring failed before Supabase save could complete.");
      } else {
        setSaveState("idle");
      }
      setProcessing(false);
      setActiveJob(null);
      setJobId(null);
    } finally {
      if (!useAsyncJob) {
        setProcessing(false);
      }
    }
  }, [pendingLeads, useCleaner, autoSaveToSupabase, supabaseStatus, currentUserId]);

  const summary = useMemo(() => {
    if (scoredLeads.length === 0) {
      return {
        total: 0,
        averageScore: 0,
        hot: 0,
        qualified: 0,
        borderline: 0,
        cold: 0
      };
    }

    const total = scoredLeads.length;
    const scoreTotal = scoredLeads.reduce((acc, item) => acc + (item.score?.final_score ?? 0), 0);

    const interpretationBuckets = scoredLeads.reduce(
      (acc, item) => {
        const interpretation = item.score?.interpretation ?? "Cold Dead";
        acc[interpretation] += 1;
        return acc;
      },
      {
        Hot: 0,
        Qualified: 0,
        Borderline: 0,
        "Cold Dead": 0
      } as Record<LeadScoreResponse["interpretation"], number>
    );

    return {
      total,
      averageScore: Number((scoreTotal / total).toFixed(2)),
      hot: interpretationBuckets.Hot,
      qualified: interpretationBuckets.Qualified,
      borderline: interpretationBuckets.Borderline,
      cold: interpretationBuckets["Cold Dead"]
    };
  }, [scoredLeads]);

  useEffect(() => {
    if (!jobId) {
      return;
    }

    let cancelled = false;
    let interval: ReturnType<typeof setInterval> | null = null;

    const poll = async () => {
      try {
        const response = await fetch(`/api/score-leads/jobs/${jobId}`);
        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          throw new Error(payload?.error ?? "Unable to fetch job status.");
        }

        const data = (await response.json()) as { job: JobSnapshot };
        if (cancelled) {
          return;
        }

        setActiveJob(data.job);
        setScoredLeads(data.job.results ?? []);

        if (data.job.supabase?.requested) {
          if (data.job.supabase.saved) {
            setSaveState("saved");
            setSaveError(null);
          } else {
            setSaveState("error");
            setSaveError(data.job.supabase.error ?? "Failed to save to Supabase.");
          }
        }

        if (data.job.status === "completed") {
          setProcessing(false);
          setJobId(null);
        } else if (data.job.status === "failed") {
          setProcessing(false);
          setJobId(null);
          setError(data.job.error ?? "Lead scoring job failed.");
          if (data.job.supabase?.requested) {
            setSaveState("error");
            setSaveError(data.job.error ?? "Supabase save failed.");
          }
        }
      } catch (pollError) {
        if (cancelled) {
          return;
        }
        setProcessing(false);
        setJobId(null);
        setActiveJob(null);
        setError(pollError instanceof Error ? pollError.message : "Unable to poll job status.");
        setSaveState((prev) => (prev === "saving" ? "error" : prev));
      }
    };

    poll();
    interval = setInterval(poll, 2000);

    return () => {
      cancelled = true;
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [jobId]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-900">
        <p className="text-sm text-slate-600">Checking authentication…</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] transition-colors">
      <main className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-10">
        <header className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="space-y-2">
              <h1 className="text-3xl font-semibold text-[var(--foreground)]">Lead Score Genius</h1>
              <p className="max-w-2xl text-sm text-[var(--muted)]">
                Upload a CSV of cold leads to generate scores with the GPT-5 powered Lead Score Genius engine. Include columns such as
                company, industry, website, and location to improve accuracy.
              </p>
            </div>
            <div className="flex flex-col items-start gap-2 sm:items-end">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium ${statusBadgeClass}`}
                >
                  <span className="h-2 w-2 rounded-full bg-current" />
                  Supabase {supabaseStatus === "connected" ? "connected" : supabaseStatus === "unknown" ? "checking" : "not configured"}
                </span>
                {currentUserEmail ? (
                  <span className="text-xs text-[var(--muted)]">Signed in as {currentUserEmail}</span>
                ) : null}
                <ThemeToggle />
                <a
                  href="/dashboard/saved"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
                >
                  Saved leads
                </a>
                <a
                  href="/dashboard/account"
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
                >
                  Account settings
                </a>
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
                >
                  Sign out
                </button>
              </div>
              {supabaseStatus === "connected" ? (
                <label className="flex cursor-pointer items-center gap-2 text-xs text-[var(--muted)]">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 rounded border border-[var(--border)] bg-[var(--surface)]"
                    style={{ accentColor: "var(--accent)" }}
                    checked={autoSaveToSupabase}
                    onChange={(event) => setAutoSaveToSupabase(event.target.checked)}
                  />
                  Auto-save scored leads to Supabase
                </label>
              ) : null}
              {activeJob && activeJob.status !== "completed" && activeJob.status !== "failed" ? (
                <p className="text-xs text-[var(--muted)]">
                  Processing job {activeJob.id.slice(0, 8)}… {activeJob.processed}/{activeJob.total} leads completed.
                </p>
              ) : null}
            </div>
          </div>
        </header>

        <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium text-[var(--foreground)]">Upload CSV</p>
              <p className="text-sm text-[var(--muted)]">Accepted format: comma or semicolon separated values with a header row.</p>
              {fileName ? <p className="text-xs text-[var(--muted)]">Loaded file: {fileName}</p> : null}
            </div>
            <label className="inline-flex cursor-pointer items-center rounded-md border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]">
              <input type="file" accept=".csv" className="hidden" onChange={handleFileUpload} />
              Choose file
            </label>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex items-center gap-2 text-sm text-[var(--muted)]">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border border-[var(--border)] bg-[var(--surface)]"
              style={{ accentColor: "var(--accent)" }}
              checked={useCleaner}
              onChange={(event) => setUseCleaner(event.target.checked)}
            />
            Pre-clean lead fields (LLM assisted)
          </label>
          <div className="text-xs text-[var(--muted)]">
            The cleaner normalizes company names, domains, and maps URLs before scoring.
          </div>
        </div>
          {pendingLeads.length > 0 || processing ? (
            <div className="mt-4 flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--surface-subtle)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-[var(--muted)]">
                {processing
                  ? activeJob && activeJob.status !== "completed" && activeJob.status !== "failed"
                    ? `Processing ${activeJob.processed}/${activeJob.total} lead${activeJob.total === 1 ? "" : "s"}…`
                    : "Scoring in progress..."
                  : `Ready to score ${pendingLeads.length} lead${pendingLeads.length === 1 ? "" : "s"}. Adjust settings, then run scoring.`}
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleScoreLeads}
                  disabled={processing || pendingLeads.length === 0}
                  className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
                    processing || pendingLeads.length === 0
                      ? "cursor-not-allowed border border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]"
                      : "border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
                  }`}
                >
                  {processing ? "Scoring…" : "Score leads"}
                </button>
              </div>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--muted)]">Upload a CSV to enable scoring.</p>
          )}
          {error ? <p className="mt-4 text-sm" style={{ color: "var(--error)" }}>{error}</p> : null}
        </section>

        {scoredLeads.length > 0 ? (
          <>
            <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition-colors">
                <p className="text-xs uppercase text-[var(--muted)]">Total leads</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.total}</p>
              </article>
              <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition-colors">
                <p className="text-xs uppercase text-[var(--muted)]">Average score</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.averageScore}</p>
              </article>
              <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition-colors">
                <p className="text-xs uppercase text-[var(--muted)]">Hot</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.hot}</p>
                <p className="text-xs text-[var(--muted)]">Qualified: {summary.qualified}</p>
              </article>
              <article className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 shadow-sm transition-colors">
                <p className="text-xs uppercase text-[var(--muted)]">Borderline / Cold</p>
                <p className="mt-2 text-2xl font-semibold text-[var(--foreground)]">{summary.borderline}</p>
                <p className="text-xs text-[var(--muted)]">Cold: {summary.cold}</p>
              </article>
            </section>

            <section className="rounded-lg border border-[var(--border)] bg-[var(--surface)] shadow-sm transition-colors">
              <div className="flex flex-col gap-3 border-b border-[var(--border-muted)] px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-lg font-semibold text-[var(--foreground)]">Processed leads</h2>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={handleDownload}
                    className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
                  >
                    Download CSV
                  </button>
                  <button
                    type="button"
                    onClick={handleSaveToSupabase}
                    disabled={
                      saveState === "saving" ||
                      scoredLeads.length === 0 ||
                      (!!activeJob && activeJob.status !== "completed")
                    }
                    className={saveButtonClass}
                  >
                    {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : "Save to Supabase"}
                  </button>
                </div>
              </div>
              {supabaseStatus === "missing" && supabaseReason ? (
                <p className="px-4 text-xs" style={{ color: "var(--warning)" }}>
                  Supabase setup incomplete: {supabaseReason}
                </p>
              ) : null}
              {supabaseStatus === "error" && supabaseReason ? (
                <p className="px-4 text-xs" style={{ color: "var(--error)" }}>
                  Supabase error: {supabaseReason}
                </p>
              ) : null}
              {saveError ? (
                <p className="px-4 text-xs" style={{ color: "var(--error)" }}>
                  {saveError}
                </p>
              ) : null}
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-[var(--border-muted)] text-left text-sm">
                  <thead className="bg-[var(--surface-subtle)] text-xs uppercase text-[var(--muted)]">
                    <tr>
                      <th scope="col" className="px-4 py-3 font-medium">Company</th>
                      <th scope="col" className="px-4 py-3 font-medium">Industry</th>
                      <th scope="col" className="px-4 py-3 font-medium">Final score</th>
                      <th scope="col" className="px-4 py-3 font-medium">Interpretation</th>
                      <th scope="col" className="px-4 py-3 font-medium">Website signals</th>
                      <th scope="col" className="px-4 py-3 font-medium">Reviews</th>
                      <th scope="col" className="px-4 py-3 font-medium">Weights</th>
                      <th scope="col" className="px-4 py-3 font-medium">Reasoning</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-muted)]">
                    {scoredLeads.map(({ lead, score, enriched }) => (
                      <tr key={lead.lead_id} className="align-top">
                        <td className="px-4 py-3 text-[var(--muted)]">
                          <p className="font-medium text-[var(--foreground)]">{lead.company}</p>
                          {lead.location ? <p className="text-xs text-[var(--muted)]">{lead.location}</p> : null}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">{score.industry ?? lead.industry ?? "default"}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">{score.final_score.toFixed(2)}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">{score.interpretation}</td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          {(() => {
                            const url = enriched.website?.url ?? (lead.website && (lead.website.startsWith("http") ? lead.website : `https://${lead.website}`));
                            if (!url) {
                              return <span className="text-[var(--muted)]">No site detected</span>;
                            }
                            return (
                              <div className="space-y-1">
                                <a href={url} className="text-[var(--accent)] underline" target="_blank" rel="noreferrer">
                                  Visit site
                                </a>
                                {enriched.website ? (
                                  <p className="text-xs text-[var(--muted)]">
                                    Score {enriched.website.finalScore} via {enriched.website.method}
                                  </p>
                                ) : (
                                  <p className="text-xs text-[var(--muted)]">No crawl data</p>
                                )}
                              </div>
                            );
                          })()}
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          <div className="space-y-1">
                            {score.scores.reviews.average_rating !== null ? (
                              <p>
                                {score.scores.reviews.average_rating}★ ({score.scores.reviews.review_count ?? "?"})
                              </p>
                            ) : (
                              <span className="text-[var(--muted)]">Not found</span>
                            )}
                            {enriched.reviews.sourceUrl ? (
                              <a
                                href={enriched.reviews.sourceUrl}
                                className="text-xs text-[var(--accent)] underline"
                                target="_blank"
                                rel="noreferrer"
                              >
                                Source ({enriched.reviews.method ?? "unknown"})
                              </a>
                            ) : (
                              <p className="text-xs text-[var(--muted)]">
                                {enriched.reviews.method
                                  ? `Method: ${enriched.reviews.method}`
                                  : "Add a /maps/place URL to your CSV to override."}
                              </p>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          <div className="text-xs text-[var(--muted)]">
                            <p>Web {formatWeight(score.weights_applied?.website_activity)}</p>
                            <p>Rev {formatWeight(score.weights_applied?.reviews)}</p>
                            <p>Years {formatWeight(score.weights_applied?.years_in_business)}</p>
                            <p>Revenue {formatWeight(score.weights_applied?.revenue_proxies)}</p>
                            <p>Fit {formatWeight(score.weights_applied?.industry_fit)}</p>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-[var(--muted)]">
                          <details className="text-xs text-[var(--muted)]">
                            <summary className="cursor-pointer text-[var(--accent)]">View reasoning</summary>
                            <pre className="whitespace-pre-wrap text-[var(--muted)]">{score.reasoning}</pre>
                            <details className="mt-2">
                              <summary className="cursor-pointer text-[var(--accent)]">Raw JSON</summary>
                              <pre className="max-h-64 overflow-auto whitespace-pre-wrap text-[var(--muted)]">
                                {JSON.stringify({ score, enriched }, null, 2)}
                              </pre>
                            </details>
                          </details>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </>
        ) : (
          <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--surface)] p-6 text-sm text-[var(--muted)] shadow-sm transition-colors">
            <p>No leads processed yet. Select a CSV file to generate GPT-5 powered scores.</p>
            <ul className="mt-3 list-disc space-y-1 pl-5">
              <li>Include at least company name and industry for best results.</li>
              <li>Optional fields like website, city, and state improve Google review matching.</li>
              <li>Download the enriched output after scoring to sync back to your CRM.</li>
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
