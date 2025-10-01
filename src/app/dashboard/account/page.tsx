"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { ThemeToggle } from "@/components/ThemeToggle";
import { getSupabaseBrowserClient } from "@/lib/supabaseBrowser";

export default function AccountSettingsPage() {
  const router = useRouter();
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  const [authChecked, setAuthChecked] = useState(false);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  const [newEmail, setNewEmail] = useState("");
  const [emailPassword, setEmailPassword] = useState("");
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailMessage, setEmailMessage] = useState<string | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);
  const [passwordMessage, setPasswordMessage] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);

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
      setAuthChecked(true);
    });

    const {
      data: { subscription }
    } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) {
        setAuthChecked(false);
        setCurrentEmail(null);
        router.replace("/");
        return;
      }
      setCurrentEmail(session.user.email ?? null);
      setAuthChecked(true);
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [router, supabase]);

  const handleEmailUpdate = useCallback(async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setEmailError(null);
    setEmailMessage(null);

    if (!currentEmail) {
      setEmailError("You must be signed in to change your email.");
      return;
    }

    if (!newEmail || newEmail === currentEmail) {
      setEmailError("Enter a different email address.");
      return;
    }

    if (!emailPassword) {
      setEmailError("Enter your current password to confirm this change.");
      return;
    }

    setEmailLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: emailPassword
      });
      if (authError) {
        setEmailError("Current password is incorrect.");
        return;
      }

      const { data, error } = await supabase.auth.updateUser({ email: newEmail });
      if (error) {
        setEmailError(error.message);
        return;
      }

      if (data.user?.email === newEmail) {
        setEmailMessage("Email updated successfully.");
        setCurrentEmail(newEmail);
      } else {
        setEmailMessage("Check your new inbox to confirm the email change.");
      }
      setNewEmail("");
      setEmailPassword("");
    } finally {
      setEmailLoading(false);
    }
  }, [currentEmail, emailPassword, newEmail, supabase]);

  const handlePasswordUpdate = useCallback(async (
    event: React.FormEvent<HTMLFormElement>
  ) => {
    event.preventDefault();
    setPasswordError(null);
    setPasswordMessage(null);

    if (!currentEmail) {
      setPasswordError("You must be signed in to change your password.");
      return;
    }

    if (!currentPassword) {
      setPasswordError("Enter your current password.");
      return;
    }

    if (newPassword.length < 6) {
      setPasswordError("New password must be at least 6 characters long.");
      return;
    }

    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords do not match.");
      return;
    }

    setPasswordLoading(true);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: currentEmail,
        password: currentPassword
      });
      if (authError) {
        setPasswordError("Current password is incorrect.");
        return;
      }

      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) {
        setPasswordError(error.message);
        return;
      }

      setPasswordMessage("Password updated successfully.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setPasswordLoading(false);
    }
  }, [confirmPassword, currentEmail, currentPassword, newPassword, supabase]);

  const handleSignOut = useCallback(async () => {
    await supabase.auth.signOut();
    router.replace("/");
  }, [router, supabase]);

  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--background)] text-[var(--foreground)] transition-colors">
        <p className="text-sm text-[var(--muted)]">Checking authentication…</p>
      </div>
    );
  }

  const busyButton = "cursor-progress border-[var(--border)] bg-[var(--surface-subtle)] text-[var(--muted)]";
  const primaryButton = "border border-[var(--accent)] bg-[var(--accent)] text-[var(--accent-contrast)] hover:bg-[var(--accent-hover)]";

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)] transition-colors">
      <div className="absolute right-6 top-6">
        <ThemeToggle />
      </div>
      <main className="mx-auto flex max-w-2xl flex-col gap-8 px-6 py-10">
        <header className="space-y-2">
          <h1 className="text-3xl font-semibold">Account settings</h1>
          <p className="text-sm text-[var(--muted)]">Update your login email or password.</p>
          <div className="flex flex-wrap gap-2 text-xs text-[var(--muted)]">
            <span className="rounded-full border border-[var(--border)] bg-[var(--surface)] px-3 py-1">
              Signed in as {currentEmail}
            </span>
            <a
              href="/dashboard"
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
            >
              Back to dashboard
            </a>
            <button
              type="button"
              onClick={handleSignOut}
              className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]"
            >
              Sign out
            </button>
          </div>
        </header>

        <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Update email</h2>
          <p className="text-sm text-[var(--muted)]">
            Enter the password you currently use to authenticate and the new email address you want on your account.
          </p>
          <form className="space-y-4" onSubmit={handleEmailUpdate}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--muted-strong)]" htmlFor="new-email">
                New email
              </label>
              <input
                id="new-email"
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="new-email@example.com"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--muted-strong)]" htmlFor="email-password">
                Current password
              </label>
              <input
                id="email-password"
                type="password"
                value={emailPassword}
                onChange={(event) => setEmailPassword(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="••••••••"
              />
            </div>
            {emailError ? <p className="text-sm" style={{ color: "var(--error)" }}>{emailError}</p> : null}
            {emailMessage ? <p className="text-sm" style={{ color: "var(--success)" }}>{emailMessage}</p> : null}
            <button
              type="submit"
              disabled={emailLoading}
              className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${emailLoading ? busyButton : primaryButton}`}
            >
              {emailLoading ? "Updating…" : "Update email"}
            </button>
          </form>
        </section>

        <section className="space-y-4 rounded-lg border border-[var(--border)] bg-[var(--surface)] p-6 shadow-sm transition-colors">
          <h2 className="text-lg font-semibold text-[var(--foreground)]">Update password</h2>
          <p className="text-sm text-[var(--muted)]">
            Re-authenticate with your current password, then choose a new password of at least 6 characters.
          </p>
          <form className="space-y-4" onSubmit={handlePasswordUpdate}>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--muted-strong)]" htmlFor="current-password">
                Current password
              </label>
              <input
                id="current-password"
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="••••••••"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--muted-strong)]" htmlFor="new-password">
                New password
              </label>
              <input
                id="new-password"
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="At least 6 characters"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-[var(--muted-strong)]" htmlFor="confirm-new-password">
                Confirm new password
              </label>
              <input
                id="confirm-new-password"
                type="password"
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm text-[var(--foreground)] outline-none transition focus:border-[var(--accent)] focus:ring-1 focus:ring-[color:var(--accent)]/50"
                placeholder="Re-enter new password"
              />
            </div>
            {passwordError ? <p className="text-sm" style={{ color: "var(--error)" }}>{passwordError}</p> : null}
            {passwordMessage ? <p className="text-sm" style={{ color: "var(--success)" }}>{passwordMessage}</p> : null}
            <button
              type="submit"
              disabled={passwordLoading}
              className={`rounded-md border px-4 py-2 text-sm font-semibold transition ${passwordLoading ? busyButton : primaryButton}`}
            >
              {passwordLoading ? "Updating…" : "Update password"}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
