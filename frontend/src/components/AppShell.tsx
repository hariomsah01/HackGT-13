"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { AskScreenProvider } from "@/lib/askScreen";
import { GlobalAsk } from "@/components/GlobalAsk";

const doctorTabs = [
  { href: "/app/patients", label: "Patients", hint: "Shared rooms" },
  { href: "/app/insights", label: "Insights", hint: "Live totals" },
  { href: "/app/updates", label: "Updates", hint: "Team activity" },
];

const patientTabs = [
  { href: "/app/me", label: "My care", hint: "Your chart" },
  { href: "/app/updates", label: "Updates", hint: "Your care overview" },
];

function Mark({ light = false }: { light?: boolean }) {
  return (
    <div
      className={`flex h-9 w-9 items-center justify-center rounded-xl ${
        light ? "bg-teal-400" : "bg-[var(--brand)]"
      }`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
        <path
          d="M4 12h4l2-6 4 12 2-6h4"
          stroke="white"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <Link href={compact ? "/app/patients" : "/"} className="flex shrink-0 items-center gap-3">
      <Mark />
      <p className="font-display text-lg font-bold tracking-tight text-[var(--ink)]">ClearPath</p>
    </Link>
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, logout, ready } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const tabs = user?.kind === "patient" ? patientTabs : doctorTabs;
  const inApp = pathname.startsWith("/app") && !!user;

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[var(--paper)] text-[var(--muted)]">
        Loading…
      </div>
    );
  }

  if (inApp) {
    return (
      <AskScreenProvider>
        <div className="flex min-h-screen min-h-dvh w-full max-w-none bg-[var(--paper)]">
          {/* Always-visible desktop rail from 768px up */}
          <aside className="sticky top-0 z-30 hidden h-dvh w-60 shrink-0 flex-col bg-[var(--sidebar)] text-white md:flex xl:w-[17.5rem]">
            <div className="flex items-center gap-3 px-5 py-6">
              <Mark light />
              <div>
                <p className="font-display text-lg font-bold tracking-tight">ClearPath</p>
                <p className="text-[11px] text-[var(--sidebar-muted)]">Care workspace</p>
              </div>
            </div>
            <nav className="mt-1 flex flex-1 flex-col gap-1 px-3">
              {tabs.map((t) => {
                const active = pathname.startsWith(t.href);
                return (
                  <Link
                    key={t.href}
                    href={t.href}
                    className={`rounded-xl px-3.5 py-3 transition ${
                      active ? "nav-active" : "nav-idle"
                    }`}
                  >
                    <p className="text-sm font-semibold">{t.label}</p>
                    <p className="text-[11px] opacity-70">{t.hint}</p>
                  </Link>
                );
              })}
            </nav>
            <div className="mt-auto border-t border-white/10 p-4">
              <div className="flex items-center gap-3">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: user.color }}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{user.label}</p>
                  <p className="truncate text-[11px] text-[var(--sidebar-muted)]">
                    {user.specialty || user.role}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                className="mt-3 w-full rounded-lg border border-white/10 px-3 py-2 text-xs font-semibold text-[var(--sidebar-muted)] transition hover:bg-white/5 hover:text-white"
              >
                Sign out
              </button>
            </div>
          </aside>

          <div className="flex min-h-dvh min-w-0 flex-1 flex-col">
            <header className="sticky top-0 z-40 flex items-center justify-between gap-3 border-b border-[var(--line)] bg-white px-4 py-3 md:hidden">
              <Logo compact />
              <button
                type="button"
                onClick={() => {
                  logout();
                  router.push("/login");
                }}
                className="rounded-lg border border-[var(--line)] px-3 py-1.5 text-xs font-semibold"
              >
                Sign out
              </button>
            </header>
            <nav className="flex gap-1 overflow-x-auto border-b border-[var(--line)] bg-white px-3 py-2 md:hidden">
              {tabs.map((t) => (
                <Link
                  key={t.href}
                  href={t.href}
                  className={`shrink-0 rounded-full px-3.5 py-1.5 text-sm font-semibold ${
                    pathname.startsWith(t.href) ? "tab-active" : "tab-idle"
                  }`}
                >
                  {t.label}
                </Link>
              ))}
            </nav>

            <div className="flex w-full min-w-0 max-w-none flex-1 flex-col">
              {children}
            </div>
          </div>
          <GlobalAsk />
        </div>
      </AskScreenProvider>
    );
  }

  return (
    <AskScreenProvider>
      <div className="flex min-h-screen min-h-dvh w-full max-w-none flex-col bg-[var(--paper)]">
        <header className="sticky top-0 z-40 w-full max-w-none border-b border-[var(--line)] bg-white/90 backdrop-blur">
          <div className="site-wrap flex items-center justify-between gap-4 py-3.5">
            <Logo />
            <div className="flex items-center gap-2">
              {user ? (
                <button
                  type="button"
                  onClick={() => {
                    logout();
                    router.push("/login");
                  }}
                  className="rounded-full border border-[var(--line)] bg-white px-3 py-1.5 text-sm font-semibold"
                >
                  Sign out
                </button>
              ) : pathname === "/login" ? null : (
                <Link
                  href={pathname === "/" ? "#sign-in" : "/#sign-in"}
                  className="rounded-full bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white"
                >
                  Sign in
                </Link>
              )}
            </div>
          </div>
        </header>
        <div className="flex w-full max-w-none flex-1 flex-col">{children}</div>
        {user && <GlobalAsk />}
      </div>
    </AskScreenProvider>
  );
}
