"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/ThemeToggle";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export default function AuthPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [resetEmail, setResetEmail] = useState("");
  const [resetLoading, setResetLoading] = useState(false);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [resetError, setResetError] = useState<string | null>(null);
  const [showResetForm, setShowResetForm] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (cancelled) return;
      if (data.session) {
        router.replace("/dashboard");
      }
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (session) {
        router.replace("/dashboard");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const handleSubmit = useCallback(async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setError(null);
    setMessage(null);
    setResetMessage(null);
    setLoading(true);

    try {
      if (mode === "signup") {
        if (!email || !password) {
          setError("Email and password are required.");
          return;
        }
        if (password.length < 6) {
          setError("Password must be at least 6 characters long.");
          return;
        }
        if (password !== confirmPassword) {
          setError("Passwords do not match.");
          return;
        }

        const response = await fetch("/api/auth/signup", {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ email, password })
        });

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}));
          if (response.status === 409) {
            setError(
              payload?.error ?? "This email is already registered. Please sign in instead."
            );
          } else {
            setError(payload?.error ?? "Failed to create account.");
          }
          return;
        }

        const { error: signInAfterSignup } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInAfterSignup) {
          setMessage("Account created. Please sign in with your credentials.");
          setMode("signin");
          setPassword("");
          setConfirmPassword("");
          return;
        }

        router.replace("/dashboard");
      } else {
        const { error: signInError } = await supabase.auth.signInWithPassword({
          email,
          password
        });
        if (signInError) {
          setError(signInError.message);
          return;
        }
        router.replace("/dashboard");
      }
    } finally {
      setLoading(false);
    }
  }, [confirmPassword, email, mode, password, router, supabase]);

  const handleResetPassword = useCallback(async () => {
    const targetEmail = resetEmail || email;
    setResetError(null);
    setResetMessage(null);

    if (!targetEmail) {
      setResetError("Enter the email associated with your account first.");
      return;
    }

    setResetLoading(true);
    try {
      const { error: resetErr } = await supabase.auth.resetPasswordForEmail(targetEmail);
      if (resetErr) {
        setResetError(resetErr.message);
        return;
      }
      setResetMessage("Password reset instructions have been emailed to you.");
      setShowResetForm(false);
    } finally {
      setResetLoading(false);
    }
  }, [email, resetEmail, supabase]);

  const toggleMode = useCallback(() => {
    setMode((prev) => (prev === "signin" ? "signup" : "signin"));
    setError(null);
    setMessage(null);
    setPassword("");
    setConfirmPassword("");
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-6 py-10 text-[var(--foreground)] transition-colors">
      <div className="absolute right-6 top-6"><ThemeToggle /></div>
      <div className="w-full max-w-md space-y-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 shadow-xl transition-colors">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold text-[var(--foreground)]">Lead Score Genius</h1>
          <p className="text-sm text-[var(--muted)]">
            {mode === "signin"
              ? "Sign in to score leads and sync results to Supabase."
              : "Create an account to start scoring and saving lead runs."}
          </p>
        </div>

        <form className="space-y-5" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium text-[var(--muted-strong)]">
              Email address
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
              placeholder="you@example.com"
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium text-[var(--muted-strong)]">
              Password
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
              placeholder="••••••••"
            />
          </div>

          {mode === "signup" ? (
            <div className="space-y-2">
              <label htmlFor="confirm-password" className="text-sm font-medium text-[var(--muted-strong)]">
                Confirm password
              </label>
              <input
                id="confirm-password"
                type="password"
                required
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="Re-enter password"
              />
            </div>
          ) : null}

          {error ? <p className="text-sm" style={{ color: "var(--error)" }}>{error}</p> : null}
          {message ? <p className="text-sm" style={{ color: "var(--success)" }}>{message}</p> : null}

          <button
            type="submit"
            disabled={loading}
            className={`w-full rounded-md border px-4 py-2 text-sm font-semibold transition ${
              loading
                ? "cursor-progress border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]"
                : "border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
            }`}
          >
            {loading ? "Processing…" : mode === "signin" ? "Sign in" : "Create account"}
          </button>
        </form>

        <div className="space-y-3 text-center text-sm text-[var(--muted)]">
          <p>
            {mode === "signin" ? "Need an account?" : "Already registered?"}{" "}
            <button type="button" onClick={toggleMode} className="text-[var(--accent)] underline">
              {mode === "signin" ? "Sign up" : "Sign in"}
            </button>
          </p>
          {mode === "signin" ? (
            <button
              type="button"
              onClick={() => {
                setShowResetForm((prev) => !prev);
                setResetError(null);
                setResetMessage(null);
              }}
              className="text-xs text-[var(--accent)] underline"
            >
              {showResetForm ? "Hide password reset" : "Forgot password?"}
            </button>
          ) : null}
        </div>

        {showResetForm ? (
          <div className="space-y-3 rounded-md border border-[var(--border)] bg-[var(--surface-subtle)] p-4 text-sm transition-colors">
            <p className="text-[var(--muted)]">Enter your email and we’ll send a reset link.</p>
            <input
              type="email"
              placeholder="you@example.com"
              value={resetEmail}
              onChange={(event) => setResetEmail(event.target.value)}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
            />
            {resetError ? <p className="text-xs" style={{ color: "var(--error)" }}>{resetError}</p> : null}
            {resetMessage ? <p className="text-xs" style={{ color: "var(--success)" }}>{resetMessage}</p> : null}
            <button
              type="button"
              onClick={handleResetPassword}
              disabled={resetLoading}
              className={`w-full rounded-md border px-3 py-2 text-xs font-semibold transition ${
                resetLoading
                  ? "cursor-progress border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]"
                  : "border-transparent bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]"
              }`}
            >
              {resetLoading ? "Sending…" : "Send reset email"}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
