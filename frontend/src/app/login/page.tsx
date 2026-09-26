"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PublicUser } from "@/lib/types";

export default function LoginPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    api.users().then((list) => {
      const ordered = [...list].sort((a, b) => {
        if (a.kind === b.kind) return 0;
        return a.kind === "patient" ? -1 : 1;
      });
      setUsers(ordered);
      if (ordered[0]) setSelected(ordered[0].id);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    router.replace(user.kind === "patient" ? "/app/me" : "/app/patients");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected || !pin.trim()) {
      setError("Choose an account and enter your PIN.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.login(selected, pin.trim());
      login(res.token, res.user);
      router.push(res.user.kind === "patient" ? "/app/me" : "/app/patients");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    } finally {
      setBusy(false);
    }
  }

  const picked = users.find((u) => u.id === selected);

  return (
    <main className="landing relative flex w-full flex-1 flex-col">
      <div className="landing-glow" aria-hidden />

      <section className="relative z-[1] flex flex-1 items-center py-12 lg:py-16">
        <div className="site-wrap grid w-full items-center gap-12 lg:grid-cols-[1fr_minmax(22rem,28rem)] lg:gap-[5vw]">
          <div className="animate-[fadeRise_0.6s_ease-out]">
            <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand)]">
              Shared care workspace
            </p>
            <h1 className="font-display mt-4 text-[clamp(2.75rem,6vw,5.5rem)] font-extrabold leading-[0.92] tracking-tight text-[var(--ink)]">
              Sign in
            </h1>
            <p className="mt-4 max-w-[36ch] text-[clamp(1.05rem,1.3vw,1.4rem)] leading-relaxed text-[var(--muted)]">
              Sign in as a patient to see your information, or as a doctor in the
              shared care space.
            </p>
            <Link
              href="/"
              className="mt-8 inline-flex text-sm font-semibold text-[var(--brand)] transition hover:text-[var(--brand-deep)]"
            >
              ← Back to ClearPath
            </Link>
          </div>

          <form
            onSubmit={onSubmit}
            className="animate-[fadeRise_0.75s_ease-out] rounded-[2rem] border border-[var(--line)] bg-white/95 p-[clamp(1.5rem,2vw,2.25rem)] shadow-[0_30px_70px_rgba(15,23,42,0.08)]"
          >
            <p className="text-sm font-semibold text-[var(--ink)]">Who are you?</p>
            <ul className="mt-4 space-y-2">
              {users.map((u) => {
                const on = selected === u.id;
                const mark =
                  u.kind === "patient"
                    ? u.label.replace("Patient ", "").slice(0, 1) || "P"
                    : u.label.replace("Doctor ", "").slice(0, 1);
                return (
                  <li key={u.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelected(u.id);
                        setPin("");
                        setError(null);
                      }}
                      className={`flex w-full items-center gap-3 rounded-2xl border px-3.5 py-3 text-left transition duration-200 ${
                        on
                          ? "border-[var(--brand)] bg-[var(--brand-soft)]/60 shadow-[0_8px_20px_rgba(15,118,110,0.12)]"
                          : "border-[var(--line)] bg-white hover:border-teal-700/30 hover:bg-slate-50"
                      }`}
                    >
                      <span
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                        style={{ background: u.color }}
                      >
                        {mark}
                      </span>
                      <span className="min-w-0">
                        <span className="font-display block font-bold tracking-tight text-[var(--ink)]">
                          {u.label}
                        </span>
                        <span className="block text-sm text-[var(--muted)]">
                          {u.specialty || u.role}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>

            <label className="mt-6 block">
              <span className="text-sm font-semibold text-[var(--ink)]">
                PIN
                {picked ? (
                  <span className="font-normal text-[var(--muted)]">
                    {" "}
                    for {picked.label}
                  </span>
                ) : null}
              </span>
              <input
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Enter your PIN"
                className="mt-2 w-full rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-base outline-none transition focus:border-[var(--brand)] focus:bg-white"
              />
            </label>

            {error && (
              <p className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={busy}
              className="mt-5 w-full rounded-2xl bg-[var(--brand)] py-3.5 text-base font-bold text-white shadow-[0_12px_28px_rgba(15,118,110,0.25)] transition hover:bg-[var(--brand-deep)] disabled:opacity-50"
            >
              {busy ? "Signing in…" : "Enter care space"}
            </button>
          </form>
        </div>
      </section>
    </main>
  );
}
