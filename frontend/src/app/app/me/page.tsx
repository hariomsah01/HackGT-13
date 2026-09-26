"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import type { PatientBundle, PatientListItem } from "@/lib/types";

export default function MePage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [list, setList] = useState<PatientListItem[]>([]);
  const [selected, setSelected] = useState("");
  const [bundle, setBundle] = useState<PatientBundle | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
    if (ready && user?.kind === "doctor") router.replace("/app/patients");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token) return;
    api.patients(token).then((p) => {
      setList(p);
      if (p[0]) setSelected(p[0].id);
    });
  }, [token]);

  useEffect(() => {
    if (!token || !selected) return;
    api.openPatient(selected, token).then(setBundle);
    api.summary(selected, token).then((r) => setSummary(r.text));
    const t = setInterval(() => {
      api.openPatient(selected, token).then(setBundle);
    }, 8000);
    return () => clearInterval(t);
  }, [token, selected]);

  const p = bundle?.patient;

  useAskScreen(
    p
      ? {
          patient_id: selected,
          patient: p,
          briefing: bundle?.briefing,
          connections: bundle?.connections,
          snapshot: bundle?.snapshot,
          plain_summary: summary,
        }
      : {},
    !!p && user?.kind === "patient"
  );

  if (!user || user.kind !== "patient") return null;

  return (
    <main className="workspace w-full max-w-none">
      <h1 className="font-display text-3xl font-bold">My care</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Your doctors already share this information. You should not need to re-explain your
        full history at every visit.
      </p>

      <label className="mt-6 block text-sm font-semibold">
        Which chart?
        <select
          value={selected}
          onChange={(e) => setSelected(e.target.value)}
          className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2"
        >
          {list.map((x) => (
            <option key={x.id} value={x.id}>
              {x.label}
            </option>
          ))}
        </select>
      </label>

      {summary && (
        <section className="card mt-6 p-5">
          <h2 className="font-display text-lg font-bold">In plain words</h2>
          <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">{summary}</p>
        </section>
      )}

      {p && (
        <>
          <section className="card mt-4 p-5">
            <h2 className="font-display text-lg font-bold">Your conditions</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {p.conditions.map((c) => (
                <li key={c.id}>
                  <strong>{c.name}</strong>
                  <span className="text-[var(--muted)]"> — {c.note}</span>
                </li>
              ))}
            </ul>
          </section>

          <section className="card mt-4 p-5">
            <h2 className="font-display text-lg font-bold">Your medicines</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {p.prescriptions
                .filter((x) => x.status === "active")
                .map((rx) => (
                  <li key={rx.id}>
                    <strong>{rx.name}</strong> {rx.dose}
                    <span className="text-[var(--muted)]"> · {rx.reason}</span>
                  </li>
                ))}
            </ul>
          </section>

          <section className="card mt-4 p-5">
            <h2 className="font-display text-lg font-bold">Your care team</h2>
            <ul className="mt-3 space-y-2 text-sm">
              {p.team.map((m) => (
                <li key={m.id}>
                  <strong>{m.label}</strong>
                  <span className="text-[var(--muted)]">
                    {" "}
                    · {m.specialty || m.role}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </main>
  );
}
