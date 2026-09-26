"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import type { Analytics } from "@/lib/types";

export default function InsightsPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);

  useAskScreen(
    data
      ? {
          analytics: data,
          totals: data.totals,
          patients: data.patients,
          activity: data.activity.slice(0, 20),
        }
      : {},
    !!data
  );

  useEffect(() => {
    if (ready && !user) router.replace("/login");
    if (ready && user?.kind === "patient") router.replace("/app/me");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token) return;
    const load = () => api.analytics(token).then(setData).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [token]);

  if (!data) {
    return (
      <main className="workspace text-[var(--muted)]">Loading insights…</main>
    );
  }

  const metrics = [
    { label: "Patients", value: data.totals.patients },
    { label: "Conditions", value: data.totals.conditions },
    { label: "Medicines", value: data.totals.active_prescriptions },
    { label: "Team links", value: data.totals.team_links },
    { label: "Avg bond", value: data.totals.avg_bond ?? "—" },
  ];

  return (
    <main className="workspace w-full">
      <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] font-extrabold leading-[0.95] tracking-tight text-[var(--ink)]">
        Care insights
      </h1>
      <p className="mt-2 text-[clamp(1rem,1.15vw,1.15rem)] text-[var(--muted)]">
        Live totals as of {new Date(data.updated_at).toLocaleTimeString()}
      </p>

      <div className="mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
        {metrics.map((m) => (
          <div
            key={m.label}
            className="rounded-[1.25rem] border border-[var(--line)] bg-white px-4 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]"
          >
            <p className="text-sm text-[var(--muted)]">{m.label}</p>
            <p className="font-display mt-1 text-3xl font-extrabold tracking-tight text-[var(--ink)]">
              {m.value}
            </p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-5 lg:grid-cols-12">
        <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-7">
          <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
            Per patient
          </h2>
          <div className="mt-5 space-y-5">
            {data.patients.map((p) => {
              const meds = Number(p.active_prescriptions || 0);
              const bond = Number(p.bond_score || 0);
              return (
                <Link
                  key={String(p.patient_id)}
                  href={`/app/patients/${p.patient_id}`}
                  className="block rounded-2xl bg-[var(--paper)] px-4 py-3 transition hover:bg-teal-50/50"
                >
                  <div className="mb-2 flex justify-between gap-3 text-sm">
                    <span className="font-semibold text-[var(--ink)]">
                      {String(p.label)}
                    </span>
                    <span className="text-[var(--muted)]">
                      Bond {bond}, {meds} meds
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-white">
                    <div
                      className="h-full rounded-full bg-[var(--brand)] transition-all duration-500"
                      style={{ width: `${Math.min(100, bond)}%` }}
                    />
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-5">
          <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
            Recent activity
          </h2>
          <ul className="mt-5 max-h-[28rem] space-y-0 overflow-y-auto">
            {data.activity
              .filter((a) => a.kind !== "viewed" && a.kind !== "ask")
              .map((a) => (
                <li
                  key={a.id}
                  className="border-b border-[var(--line)] py-3 last:border-0"
                >
                  <span className="text-xs text-[var(--muted)]">
                    {new Date(a.timestamp).toLocaleTimeString()}
                  </span>
                  <p className="mt-0.5 text-sm leading-relaxed text-[var(--ink)]">
                    <span className="font-semibold">{a.actor_label}</span>{" "}
                    {a.detail}
                  </p>
                </li>
              ))}
            {!data.activity.length && (
              <li className="py-6 text-sm text-[var(--muted)]">Quiet for now.</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
