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
    return <main className="workspace text-[var(--muted)]">Loading insights…</main>;
  }

  return (
    <main className="workspace w-full">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="font-display text-3xl font-bold tracking-tight xl:text-4xl">
            Insights
          </h1>
          <p className="mt-1 text-[var(--muted)]">
            Live care-space totals · {new Date(data.updated_at).toLocaleTimeString()}
          </p>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
        {[
          ["Patients", data.totals.patients],
          ["Conditions", data.totals.conditions],
          ["Active medicines", data.totals.active_prescriptions],
          ["Team links", data.totals.team_links],
          ["Avg bond", data.totals.avg_bond ?? "—"],
          ["Needs attention", data.totals.needs_attention ?? 0],
        ].map(([k, v]) => (
          <div key={String(k)} className="card p-5">
            <p className="text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              {k}
            </p>
            <p className="font-display mt-2 text-4xl font-bold tracking-tight">{v}</p>
          </div>
        ))}
      </div>

      <div className="mt-8 grid gap-6 xl:grid-cols-5">
        <section className="card p-5 xl:col-span-3">
          <h2 className="font-display text-lg font-bold">Per patient</h2>
          <div className="mt-5 space-y-5">
            {data.patients.map((p) => {
              const meds = Number(p.active_prescriptions || 0);
              const bond = Number(p.bond_score || 0);
              const attn = p.attention as { badge?: string; level?: string } | undefined;
              return (
                <Link
                  key={String(p.patient_id)}
                  href={`/app/patients/${p.patient_id}`}
                  className="block"
                >
                  <div className="mb-1.5 flex justify-between gap-3 text-sm">
                    <span className="font-semibold">
                      {String(p.label)}
                      {attn?.badge && attn.level !== "clear" && (
                        <span className="ml-2 text-[10px] font-bold uppercase text-amber-800">
                          {attn.badge}
                        </span>
                      )}
                    </span>
                    <span className="text-[var(--muted)]">
                      bond {bond} · {meds} meds
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100">
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

        <section className="card p-5 xl:col-span-2">
          <h2 className="font-display text-lg font-bold">Live feed</h2>
          <ul className="mt-4 max-h-[28rem] space-y-0 overflow-y-auto text-sm">
            {data.activity.map((a) => (
              <li key={a.id} className="border-b border-[var(--line)] py-3 last:border-0">
                <span className="text-xs text-[var(--muted)]">
                  {new Date(a.timestamp).toLocaleTimeString()}
                </span>
                <p className="mt-0.5">
                  <strong>{a.actor_label}</strong> — {a.detail}
                </p>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </main>
  );
}
