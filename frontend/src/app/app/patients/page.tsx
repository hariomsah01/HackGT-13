"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import type { PatientListItem } from "@/lib/types";

export default function PatientsPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [patients, setPatients] = useState<PatientListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useAskScreen(
    { patients, patient_count: patients.length },
    patients.length > 0 && user?.kind === "doctor"
  );

  useEffect(() => {
    if (ready && !user) router.replace("/login");
    if (ready && user?.kind === "patient") router.replace("/app/me");
  }, [ready, user, router]);

  async function load() {
    if (!token) return;
    setPatients(await api.patients(token));
  }

  useEffect(() => {
    load().catch((e) => setError(String(e.message || e)));
    const id = setInterval(() => load().catch(() => {}), 7000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!user || user.kind === "patient") return null;

  const filtered = patients.filter((p) => {
    if (!q.trim()) return true;
    const hay = `${p.label} ${p.conditions.join(" ")} ${p.team.join(" ")}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <main className="workspace w-full max-w-none">
      <header className="w-full border-b border-[var(--line)] pb-6">
        <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] font-extrabold leading-[0.95] tracking-tight text-[var(--ink)]">
          Your patient charts
        </h1>
        <p className="mt-2 text-[clamp(1rem,1.15vw,1.15rem)] text-[var(--muted)]">
          Review your patients.
        </p>
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search by name, condition, or doctor…"
          className="mt-5 w-full rounded-2xl border border-[var(--line)] bg-white px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)]"
        />
      </header>

      {error && (
        <p className="mt-6 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      <div className="mt-6 overflow-hidden rounded-[1.5rem] border border-[var(--line)] bg-white shadow-[0_12px_28px_rgba(15,23,42,0.04)]">
        <div className="hidden border-b border-[var(--line)] bg-[var(--paper)] px-6 py-3 text-xs font-semibold uppercase tracking-wide text-[var(--muted)] lg:grid lg:grid-cols-[1.2fr_0.5fr_0.6fr_1.4fr_1fr_auto] lg:gap-4">
          <span>Patient</span>
          <span>Age</span>
          <span>Medicines</span>
          <span>Conditions</span>
          <span>Care team</span>
          <span className="sr-only">Open</span>
        </div>

        <ul>
          {filtered.map((p, i) => {
            const active = !!p.viewing_now?.length;
            return (
              <li
                key={p.id}
                className={i > 0 ? "border-t border-[var(--line)]" : ""}
              >
                <Link
                  href={`/app/patients/${p.id}`}
                  className="grid gap-3 px-5 py-4 transition hover:bg-teal-50/40 sm:px-6 lg:grid-cols-[1.2fr_0.5fr_0.6fr_1.4fr_1fr_auto] lg:items-center lg:gap-4"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <p className="font-display text-lg font-bold text-[var(--ink)]">
                        {p.label}
                      </p>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                          active ? "text-emerald-800" : "text-slate-500"
                        }`}
                      >
                        <span
                          className={`h-2 w-2 rounded-full ${
                            active ? "bg-emerald-500" : "bg-slate-300"
                          }`}
                          aria-hidden
                        />
                        {active ? "Active" : "Inactive"}
                      </span>
                    </div>
                    {active && (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {p.viewing_now!.join(", ")}
                      </p>
                    )}
                  </div>

                  <p className="text-sm text-[var(--muted)] lg:text-[var(--ink)]">
                    <span className="lg:hidden">Age </span>
                    {p.age}
                  </p>

                  <p className="text-sm text-[var(--muted)] lg:text-[var(--ink)]">
                    {p.active_prescriptions} active
                  </p>

                  <p className="text-sm leading-relaxed text-[var(--muted)] lg:text-[var(--ink)]">
                    {p.conditions.join(", ")}
                  </p>

                  <p className="text-sm leading-relaxed text-[var(--muted)]">
                    {p.team.join(", ")}
                  </p>

                  <span className="inline-flex w-fit items-center justify-center rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white transition group-hover:bg-[var(--brand-deep)] lg:justify-self-end">
                    Open room
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>

        {!filtered.length && (
          <p className="px-6 py-14 text-center text-sm text-[var(--muted)]">
            {patients.length
              ? "No matches for that search."
              : "No patient charts are available yet."}
          </p>
        )}
      </div>
    </main>
  );
}
