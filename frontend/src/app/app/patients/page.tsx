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
  const [busy, setBusy] = useState(false);
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

  async function addPatient() {
    if (!token) return;
    setBusy(true);
    try {
      const p = await api.createPatient(token);
      await load();
      router.push(`/app/patients/${p.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setBusy(false);
    }
  }

  if (!user || user.kind === "patient") return null;

  const filtered = patients.filter((p) => {
    if (!q.trim()) return true;
    const hay = `${p.label} ${p.conditions.join(" ")} ${p.team.join(" ")}`.toLowerCase();
    return hay.includes(q.trim().toLowerCase());
  });

  return (
    <main className="workspace flex w-full flex-1 flex-col gap-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight xl:text-4xl">
            Patients
          </h1>
          <p className="mt-1 text-[var(--muted)]">
            {patients.length} shared rooms · Doctors A–D on every team
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search patients, conditions, doctors…"
            className="w-full min-w-[220px] rounded-xl border border-[var(--line)] bg-white px-4 py-2.5 text-sm outline-none focus:border-teal-700 sm:w-72 lg:w-96"
          />
          <button
            type="button"
            disabled={busy}
            onClick={addPatient}
            className="rounded-xl bg-[var(--brand)] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-50"
          >
            Add patient
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      {/* Full-bleed desktop table */}
      <div className="card hidden overflow-hidden lg:block">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
            <tr>
              <th className="px-5 py-3.5">Patient</th>
              <th className="px-5 py-3.5">Age</th>
              <th className="px-5 py-3.5">Medicines</th>
              <th className="px-5 py-3.5">Conditions</th>
              <th className="px-5 py-3.5">Care team</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((p) => (
              <tr
                key={p.id}
                className="cursor-pointer border-t border-[var(--line)] transition hover:bg-teal-50/40"
                onClick={() => router.push(`/app/patients/${p.id}`)}
              >
                <td className="whitespace-nowrap px-5 py-4">
                  <p className="font-display text-base font-bold">{p.label}</p>
                  <p className="text-xs text-[var(--brand)]">Open room →</p>
                </td>
                <td className="whitespace-nowrap px-5 py-4 text-[var(--muted)]">{p.age}</td>
                <td className="whitespace-nowrap px-5 py-4">
                  <span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-bold text-slate-700">
                    {p.active_prescriptions} active
                  </span>
                </td>
                <td className="px-5 py-4">
                  <div className="flex flex-wrap gap-1.5">
                    {p.conditions.map((c) => (
                      <span
                        key={c}
                        className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-teal-900"
                      >
                        {c}
                      </span>
                    ))}
                  </div>
                </td>
                <td className="px-5 py-4 text-[var(--muted)]">{p.team.join(" · ")}</td>
              </tr>
            ))}
            {!filtered.length && (
              <tr>
                <td colSpan={5} className="px-5 py-16 text-center text-[var(--muted)]">
                  {patients.length
                    ? "No matches for that search."
                    : "No patients yet. Add one to open a shared room."}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Mobile / tablet cards */}
      <div className="grid gap-3 sm:grid-cols-2 lg:hidden">
        {filtered.map((p) => (
          <Link
            key={p.id}
            href={`/app/patients/${p.id}`}
            className="card flex flex-col p-5 transition hover:border-teal-600/50"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-display text-xl font-bold">{p.label}</p>
                <p className="mt-0.5 text-sm text-[var(--muted)]">
                  Age {p.age} · {p.active_prescriptions} meds
                </p>
              </div>
              <span className="rounded-lg bg-slate-100 px-2 py-1 text-xs font-bold text-slate-600">
                Open
              </span>
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {p.conditions.map((c) => (
                <span
                  key={c}
                  className="rounded-md bg-[var(--brand-soft)] px-2 py-0.5 text-xs font-medium text-teal-900"
                >
                  {c}
                </span>
              ))}
            </div>
            <p className="mt-auto pt-4 text-xs text-[var(--muted)]">{p.team.join(" · ")}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
