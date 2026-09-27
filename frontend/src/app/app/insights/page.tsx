"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import { PatientInsights } from "@/components/PatientInsights";
import type { ActivityEvent, Analytics, PatientBundle } from "@/lib/types";

const COLLAB_KINDS = new Set([
  "message",
  "note",
  "rx_add",
  "rx_analyze",
  "rx_stop",
  "office_call",
  "visit",
  "brief",
]);

const RX_KINDS = new Set(["rx_add", "rx_analyze", "rx_stop"]);

const FEED_FILTERS = [
  { id: "team", label: "Notes & messages" },
  { id: "rx", label: "Medicines" },
] as const;

type FeedFilter = (typeof FEED_FILTERS)[number]["id"];

function activityLabel(kind: string) {
  switch (kind) {
    case "message":
      return "Team message";
    case "note":
      return "Doctor note";
    case "rx_add":
      return "Medicine update";
    case "rx_analyze":
      return "Medicine check";
    case "rx_stop":
      return "Medicine completed";
    case "office_call":
      return "Ava conversation";
    case "visit":
      return "Visit note";
    case "brief":
      return "Care update";
    default:
      return "Update";
  }
}

export default function InsightsPage() {
  const { user } = useAuth();
  if (user?.kind === "patient") return <PatientView />;
  return <DoctorView />;
}

function PatientView() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const chartId = user?.chart_id || "";
  const [bundle, setBundle] = useState<PatientBundle | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useAskScreen(
    {
      patient_id: chartId,
      snapshot: bundle?.snapshot,
      connections: bundle?.connections,
      reports: bundle?.patient?.reports,
      activity: events.slice(0, 20),
    },
    !!bundle
  );

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token || !chartId) return;
    const load = () => {
      api.openPatient(chartId, token).then(setBundle).catch(() => {});
      api
        .activity(token, chartId)
        .then((list) => setEvents(list.filter((e) => COLLAB_KINDS.has(e.kind))))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [token, chartId]);

  if (!user) return null;
  return <PatientInsights bundle={bundle} events={events} loading={!bundle} />;
}

function DoctorView() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<Analytics | null>(null);
  const [filter, setFilter] = useState<FeedFilter>("team");

  useAskScreen(
    data
      ? {
          analytics: data,
          totals: data.totals,
          patients: data.patients,
          activity: data.activity.slice(0, 20),
          handoffs: (data.handoffs || []).slice(0, 10),
        }
      : {},
    !!data
  );

  useEffect(() => {
    if (ready && !user) router.replace("/login");
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

  const handoffs = (data.handoffs || []).filter((h) => h.next_step || h.open_question);
  const feed = data.activity
    .filter((a) => COLLAB_KINDS.has(a.kind))
    .filter((a) =>
      filter === "rx" ? RX_KINDS.has(a.kind) : !RX_KINDS.has(a.kind)
    );

  return (
    <main className="workspace w-full">
      <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] font-extrabold leading-[0.95] tracking-tight text-[var(--ink)]">
        Insights
      </h1>
      <p className="mt-2 text-[clamp(1rem,1.15vw,1.15rem)] text-[var(--muted)]">
        Totals, open handoffs, and team activity. Updated{" "}
        {new Date(data.updated_at).toLocaleTimeString()}.
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

      {!!handoffs.length && (
        <section className="mt-8">
          <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
            Open handoffs
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {handoffs.map((h) => (
              <Link
                key={h.patient_id}
                href={`/app/patients/${h.patient_id}`}
                className="rounded-[1.5rem] border border-[var(--line)] bg-white px-5 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)] transition hover:-translate-y-0.5 hover:border-teal-600/35"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <p className="font-display text-base font-bold text-[var(--ink)]">
                    {h.patient_label}
                  </p>
                  {h.owner && (
                    <span className="shrink-0 text-xs text-[var(--muted)]">{h.owner}</span>
                  )}
                </div>
                {h.open_question && (
                  <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-[var(--ink)]/80">
                    {h.open_question}
                  </p>
                )}
                {h.next_step && (
                  <p className="mt-2 text-xs font-semibold text-teal-900">
                    Next: {h.next_step}
                  </p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      <div className="mt-8 grid gap-5 lg:grid-cols-12">
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
              Team activity
            </h2>
            <div className="flex gap-1 rounded-full bg-[var(--paper)] p-1">
              {FEED_FILTERS.map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setFilter(f.id)}
                  className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
                    filter === f.id
                      ? "bg-white text-[var(--ink)] shadow-sm"
                      : "text-[var(--muted)] hover:text-[var(--ink)]"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
          <ul className="mt-4 max-h-[32rem] overflow-y-auto">
            {feed.map((a) => (
              <li
                key={a.id}
                className="border-b border-[var(--line)] py-3 last:border-0"
              >
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="font-semibold text-[var(--brand)]">
                    {activityLabel(a.kind)}
                  </span>
                  <span className="text-[var(--muted)]">
                    {new Date(a.timestamp).toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="mt-1 text-sm leading-relaxed text-[var(--ink)]">
                  <span className="font-semibold">{a.actor_label}</span>{" "}
                  {a.detail}
                </p>
              </li>
            ))}
            {!feed.length && (
              <li className="py-6 text-sm text-[var(--muted)]">Quiet for now.</li>
            )}
          </ul>
        </section>
      </div>
    </main>
  );
}
