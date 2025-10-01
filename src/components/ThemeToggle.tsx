"use client";

import { useTheme } from "@/lib/theme";

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={`inline-flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)] ${className ?? ""}`.trim()}
    >
      <span className="text-sm" aria-hidden>
        {theme === "dark" ? "🌙" : "☀️"}
      </span>
      <span>{theme === "dark" ? "Dark" : "Light"} mode</span>
    </button>
  );
}
