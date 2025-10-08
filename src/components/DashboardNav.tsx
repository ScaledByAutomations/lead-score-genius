"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { PropsWithChildren } from "react";

import { ThemeToggle } from "@/components/ThemeToggle";

type DashboardNavProps = PropsWithChildren<{
  onSignOut?: () => void;
}>;

const NAV_LINKS = [
  { href: "/dashboard", label: "Lead scoring" },
  { href: "/dashboard/saved", label: "Saved leads" },
  { href: "/dashboard/usage", label: "Token usage" },
  { href: "/dashboard/account", label: "Account settings" }
];

export function DashboardNav({ onSignOut, children }: DashboardNavProps) {
  const pathname = usePathname();
  const baseLinkClass =
    "rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-xs font-medium text-[var(--foreground)] shadow-sm transition hover:border-[var(--accent)] hover:bg-[var(--surface-subtle)]";

  return (
    <nav className="flex flex-wrap items-center gap-2">
      {children}
      <ThemeToggle />
      {NAV_LINKS.map((item) => {
        const isActive = item.href === "/dashboard" ? pathname === item.href : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`${baseLinkClass} ${
              isActive ? "border-[var(--accent)] text-[var(--accent)]" : ""
            }`}
          >
            {item.label}
          </Link>
        );
      })}
      {onSignOut ? (
        <button
          type="button"
          onClick={onSignOut}
          className={baseLinkClass}
        >
          Sign out
        </button>
      ) : null}
    </nav>
  );
}
