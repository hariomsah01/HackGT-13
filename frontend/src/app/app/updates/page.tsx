"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import { CareGraph, careNodeKindLabel, type CareGraphSelection } from "@/components/CareGraph";
import type {
  ActivityEvent,
  AttentionFlag,
  HandoffPack,
  Patient,
  PatientBundle,
  Report,
} from "@/lib/types";

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

function collabLabel(kind: string) {
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
      return "Office call";
    case "visit":
      return "Visit note";
    case "brief":
      return "Care update";
    default:
      return "Update";
  }
}

function parseLabValue(value: string): number | null {
  const n = Number.parseFloat(String(value).replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}

function doctorHue(label: string, i = 0) {
  const hues = ["#0F766E", "#1D4ED8", "#B45309", "#7C3AED"];
  if (label.startsWith("Doctor ")) {
    const letter = label.replace("Doctor ", "").charAt(0);
    return hues[Math.max(0, letter.charCodeAt(0) - 65) % hues.length];
  }
  return hues[i % hues.length];
}

function alertTone(level: string) {
  if (level === "caution") return "border-rose-200 bg-rose-50/70";
  if (level === "review") return "border-amber-200 bg-amber-50/70";
  if (level === "handoff") return "border-sky-200 bg-sky-50/70";
  return "border-[var(--line)] bg-[var(--paper)]";
}

function alertBadge(level: string) {
  if (level === "caution") return "Alert";
  if (level === "review") return "Review";
  if (level === "handoff") return "Open item";
  return "Notice";
}

function patientAlerts(flags: AttentionFlag[]): AttentionFlag[] {
  return flags.filter((f) => f.level !== "clear");
}

function mapSelectionDetail(sel: CareGraphSelection, patient: Patient) {
  if (sel.type === "patient") {
    return {
      title: sel.label,
      kind: careNodeKindLabel(sel.type),
      lines: [
        `Age ${patient.age}`,
        `${patient.conditions.length} conditions`,
        `${patient.prescriptions.filter((r) => r.status === "active").length} active medicines`,
        `${patient.team.length} doctors on your team`,
      ],
    };
  }
  if (sel.type === "doctor") {
    const member = patient.team.find((m) => m.id === sel.id);
    const rx = patient.prescriptions.filter(
      (r) => r.status === "active" && r.prescribed_by === sel.id
    );
    return {
      title: sel.label,
      kind: careNodeKindLabel(sel.type),
      lines: [
        member?.specialty || sel.specialty || member?.role || "Care team",
        rx.length
          ? `Prescribes ${rx.map((r) => r.name).join(", ")}`
          : "No active medicines prescribed on this chart",
      ],
    };
  }
  if (sel.type === "condition") {
    const cond = patient.conditions.find(
      (c) => `cond_${c.id}` === sel.id || c.name === sel.label
    );
    return {
      title: cond?.name || sel.label,
      kind: careNodeKindLabel(sel.type),
      lines: [
        cond?.note || "On your chart",
        cond?.since ? `Since ${cond.since}` : "",
        cond?.status ? `Status ${cond.status}` : "",
      ].filter(Boolean),
    };
  }
  if (sel.type === "prescription") {
    const rx = patient.prescriptions.find((r) => r.id === sel.id || r.name === sel.label);
    const who =
      patient.team.find((m) => m.id === rx?.prescribed_by)?.label ||
      rx?.prescribed_by ||
      "Care team";
    return {
      title: rx?.name || sel.label,
      kind: careNodeKindLabel(sel.type),
      lines: [
        rx?.dose || "",
        rx?.reason || "",
        `Prescribed by ${who}`,
        rx?.started ? `Started ${rx.started}` : "",
      ].filter(Boolean),
    };
  }
  return {
    title: sel.label,
    kind: careNodeKindLabel(sel.type),
    lines: [] as string[],
  };
}

export default function UpdatesPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const isPatient = user?.kind === "patient";
  const chartId = user?.chart_id || "";

  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffPack[]>([]);
  const [bundle, setBundle] = useState<PatientBundle | null>(null);

  useAskScreen(
    isPatient
      ? {
          patient_id: chartId,
          snapshot: bundle?.snapshot,
          connections: bundle?.connections,
          reports: bundle?.patient?.reports,
          activity: events.slice(0, 20),
        }
      : {
          activity: events.slice(0, 30),
          handoffs: handoffs.slice(0, 10),
        },
    isPatient ? !!bundle : events.length > 0 || handoffs.length > 0
  );

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token) return;
    const load = () => {
      if (isPatient && chartId) {
        api
          .openPatient(chartId, token)
          .then(setBundle)
          .catch(() => {});
        api
          .activity(token, chartId)
          .then((list) =>
            setEvents(list.filter((e) => COLLAB_KINDS.has(e.kind)))
          )
          .catch(() => {});
      } else {
        api
          .activity(token)
          .then((list) =>
            setEvents(
              list.filter((e) => e.kind !== "viewed" && e.kind !== "ask")
            )
          )
          .catch(() => {});
        api
          .handoffs(token)
          .then((r) => setHandoffs(r.handoffs || []))
          .catch(() => {});
      }
    };
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [token, isPatient, chartId]);

  if (!user) return null;

  if (isPatient) {
    return (
      <PatientMetrics
        bundle={bundle}
        events={events}
        loading={!bundle}
      />
    );
  }

  const rxEvents = events.filter((e) =>
    ["rx_analyze", "rx_add", "rx_stop"].includes(e.kind)
  );
  const collab = events.filter((e) => COLLAB_KINDS.has(e.kind));

  return (
    <main className="workspace w-full">
      <h1 className="font-display text-[clamp(2.25rem,4vw,3.5rem)] font-extrabold leading-[0.95] tracking-tight text-[var(--ink)]">
        Team updates
      </h1>
      <p className="mt-2 text-[clamp(1rem,1.15vw,1.15rem)] text-[var(--muted)]">
        Handoffs, medicines, and team notes
      </p>

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
                <p className="font-display text-base font-bold text-[var(--ink)]">
                  {h.patient_label}
                </p>
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

      {!!rxEvents.length && (
        <section className="mt-8">
          <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
            Medicine checks
          </h2>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {rxEvents.slice(0, 6).map((e) => (
              <article
                key={e.id}
                className="rounded-[1.5rem] border border-[var(--line)] bg-white px-5 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]"
              >
                <p className="text-xs text-[var(--muted)]">
                  {new Date(e.timestamp).toLocaleString()}
                </p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
                  <span className="font-semibold">{e.actor_label}</span> {e.detail}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <section className="mt-8">
        <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
          Recent
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {collab.map((e) => (
            <article
              key={e.id}
              className="rounded-[1.5rem] border border-[var(--line)] bg-white px-5 py-4 shadow-[0_12px_28px_rgba(15,23,42,0.04)]"
            >
              <p className="text-xs text-[var(--muted)]">
                {new Date(e.timestamp).toLocaleString()}
              </p>
              <p className="mt-1 text-xs font-semibold text-[var(--brand)]">
                {collabLabel(e.kind)}
              </p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]">
                <span className="font-semibold">{e.actor_label}</span> {e.detail}
              </p>
            </article>
          ))}
          {!collab.length && (
            <p className="col-span-full rounded-[1.5rem] border border-[var(--line)] bg-white px-6 py-12 text-center text-[var(--muted)]">
              No updates yet.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}

function PatientMetrics({
  bundle,
  events,
  loading,
}: {
  bundle: PatientBundle | null;
  events: ActivityEvent[];
  loading: boolean;
}) {
  const p = bundle?.patient;
  const snap = bundle?.snapshot;
  const connections = bundle?.connections;
  const [mapSel, setMapSel] = useState<CareGraphSelection | null>(null);
  const medicineUpdates = events.filter((e) =>
    ["rx_add", "rx_analyze", "rx_stop"].includes(e.kind)
  );
  const alerts = patientAlerts(bundle?.attention?.flags || []);

  const metrics = useMemo(() => {
    if (!p || !snap) return [];
    return [
      { label: "Conditions", value: snap.conditions ?? p.conditions.length },
      {
        label: "Medicines",
        value:
          snap.active_prescriptions ??
          p.prescriptions.filter((x) => x.status === "active").length,
      },
      { label: "Treatments", value: snap.treatments ?? p.treatments.length },
      { label: "Labs", value: snap.reports ?? p.reports.length },
      { label: "Doctors", value: snap.team_size ?? p.team.length },
      { label: "Messages", value: snap.messages ?? 0 },
    ];
  }, [p, snap]);

  const rxByDoctor = useMemo(() => {
    if (!p) return [];
    const map = new Map<string, number>();
    for (const rx of p.prescriptions.filter((x) => x.status === "active")) {
      const who =
        p.team.find((m) => m.id === rx.prescribed_by)?.label ||
        rx.prescribed_by;
      map.set(who, (map.get(who) || 0) + 1);
    }
    const max = Math.max(1, ...map.values());
    return [...map.entries()].map(([label, count]) => ({
      label,
      count,
      pct: Math.round((count / max) * 100),
    }));
  }, [p]);

  const teamScores = useMemo(() => {
    const rows = connections?.team_connection || [];
    return rows.map((m) => ({
      label: m.label,
      specialty: m.specialty || m.role,
      score: Math.round(m.connection_score),
      closeness: m.closeness,
    }));
  }, [connections]);

  const selectedDetail = useMemo(() => {
    if (!mapSel || !p) return null;
    return mapSelectionDetail(mapSel, p);
  }, [mapSel, p]);

  return (
    <main className="landing relative w-full flex-1">
      <div className="landing-glow" aria-hidden />

      <div className="relative z-[1] site-wrap py-10 lg:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand)]">
          Updates
        </p>
        <h1 className="font-display mt-3 text-[clamp(2.5rem,5vw,4.5rem)] font-extrabold leading-[0.92] tracking-tight text-[var(--ink)]">
          Your care at a glance
        </h1>

        {loading && (
          <p className="mt-10 text-sm text-[var(--muted)]">Loading…</p>
        )}

        {p && snap && (
          <div className="mt-10 grid gap-5 lg:mt-12 lg:grid-cols-12 lg:gap-6">
            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-12">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Important notifications
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Alerts from your doctors
              </p>
              {alerts.length ? (
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {alerts.map((f) => (
                    <li
                      key={f.code}
                      className={`rounded-2xl border px-4 py-4 ${alertTone(f.level)}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <p className="font-display text-base font-bold text-[var(--ink)]">
                          {f.patient_title || f.title}
                        </p>
                        <span className="shrink-0 rounded-md bg-white/70 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                          {alertBadge(f.level)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--ink)]/80">
                        {f.patient_detail || f.detail}
                      </p>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 text-sm text-[var(--muted)]">
                  No alerts right now.
                </p>
              )}
            </section>

            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:col-span-12 lg:grid-cols-6">
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
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-6">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Visit notes
              </h2>
              <ul className="mt-5 space-y-5">
                {p.notes.map((n, i) => (
                  <li key={n.id} className="flex gap-3">
                    <span
                      className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                      style={{ background: doctorHue(n.author_label, i) }}
                    >
                      {n.author_label.replace("Doctor ", "").slice(0, 1)}
                    </span>
                    <div className="min-w-0">
                      <p className="font-display text-base font-bold text-[var(--ink)]">
                        {n.author_label}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{n.date}</p>
                      <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                        {n.text}
                      </p>
                    </div>
                  </li>
                ))}
                {!p.notes.length && (
                  <li className="text-sm text-[var(--muted)]">No notes yet.</li>
                )}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-6">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Messages
              </h2>
              <ul className="mt-5 space-y-5">
                {[...(bundle?.room?.messages || [])]
                  .filter((m) => m.author_label.startsWith("Doctor"))
                  .reverse()
                  .slice(0, 6)
                  .map((m, i) => (
                    <li key={m.id} className="flex gap-3">
                      <span
                        className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                        style={{ background: doctorHue(m.author_label, i) }}
                      >
                        {m.author_label.replace("Doctor ", "").slice(0, 1)}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <p className="font-display text-base font-bold text-[var(--ink)]">
                            {m.author_label}
                          </p>
                          <p className="text-xs text-[var(--muted)]">
                            {new Date(m.timestamp).toLocaleDateString()}
                          </p>
                        </div>
                        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                          {m.text}
                        </p>
                      </div>
                    </li>
                  ))}
                {!(bundle?.room?.messages || []).some((m) =>
                  m.author_label.startsWith("Doctor")
                ) && (
                  <li className="text-sm text-[var(--muted)]">No messages yet.</li>
                )}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-7">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Lab results
              </h2>
              <LabBars reports={p.reports} />
              <ul className="mt-6 divide-y divide-[var(--line)]">
                {p.reports.map((r) => (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-baseline justify-between gap-2 py-3 first:pt-0"
                  >
                    <div>
                      <p className="font-display text-base font-bold text-[var(--ink)]">
                        {r.title}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--muted)]">{r.date}</p>
                    </div>
                    <p className="font-display text-lg font-bold tabular-nums text-[var(--ink)]">
                      {r.value}
                      <span className="ml-1 text-sm font-semibold text-[var(--muted)]">
                        {r.unit}
                      </span>
                    </p>
                  </li>
                ))}
                {!p.reports.length && (
                  <li className="py-4 text-sm text-[var(--muted)]">No labs yet.</li>
                )}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-5">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Your care team
              </h2>
              <div className="mt-4 flex items-end gap-2">
                <p className="font-display text-4xl font-extrabold tracking-tight text-[var(--ink)]">
                  {connections?.bond_score ?? "—"}
                </p>
                <p className="mb-1 text-sm text-[var(--muted)]">team score</p>
              </div>
              <ul className="mt-6 space-y-4">
                {teamScores.map((m, i) => (
                  <li key={m.label}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-semibold text-[var(--ink)]">
                        {m.label}
                      </span>
                      <span className="tabular-nums text-[var(--muted)]">
                        {m.score}
                      </span>
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--muted)]">
                      {m.specialty}
                    </p>
                    <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--paper)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${Math.min(100, m.score)}%`,
                          background: doctorHue(m.label, i),
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-5">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Your medicines
              </h2>
              <ul className="mt-5 space-y-3">
                {p.prescriptions
                  .filter((x) => x.status === "active")
                  .map((rx) => {
                    const who =
                      p.team.find((m) => m.id === rx.prescribed_by)?.label ||
                      "Care team";
                    return (
                      <li
                        key={rx.id}
                        className="rounded-2xl bg-[var(--paper)] px-4 py-3"
                      >
                        <p className="font-display font-bold text-[var(--ink)]">
                          {rx.name}
                        </p>
                        <p className="mt-1 text-sm text-[var(--muted)]">
                          {rx.dose}
                        </p>
                        <p className="mt-1 text-xs text-[var(--muted)]">
                          From {who}
                          {rx.reason ? `. ${rx.reason}` : ""}
                        </p>
                      </li>
                    );
                  })}
                {!rxByDoctor.length && (
                  <li className="text-sm text-[var(--muted)]">No active medicines.</li>
                )}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-7">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Who prescribed what
              </h2>
              <ul className="mt-5 space-y-4">
                {rxByDoctor.map((row, i) => (
                  <li key={row.label}>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <span className="font-semibold text-[var(--ink)]">
                        {row.label}
                      </span>
                      <span className="tabular-nums text-[var(--muted)]">
                        {row.count}
                      </span>
                    </div>
                    <div className="mt-2 h-2.5 overflow-hidden rounded-full bg-[var(--paper)]">
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${row.pct}%`,
                          background: doctorHue(row.label, i),
                        }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-12">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                    Care map
                  </h2>
                  <p className="mt-1 text-sm text-[var(--muted)]">
                    Tap a circle to learn more
                  </p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-[var(--muted)]">
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#0F766E]" /> You
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#1E293B]" /> Doctor
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#1D4ED8]" /> Condition
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <span className="h-2.5 w-2.5 rounded-full bg-[#B45309]" /> Medicine
                  </span>
                </div>
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-12">
                <div className="lg:col-span-8">
                  {bundle?.graph ? (
                    <CareGraph
                      graph={bundle.graph}
                      clean
                      heightClass="h-[380px] sm:h-[420px]"
                      onSelect={setMapSel}
                    />
                  ) : (
                    <p className="p-6 text-sm text-[var(--muted)]">No graph yet.</p>
                  )}
                </div>
                <aside className="rounded-2xl border border-[var(--line)] bg-[var(--paper)] p-5 lg:col-span-4">
                  {selectedDetail ? (
                    <>
                      <p className="text-xs font-semibold text-[var(--brand)]">
                        {selectedDetail.kind}
                      </p>
                      <p className="font-display mt-2 text-xl font-bold text-[var(--ink)]">
                        {selectedDetail.title}
                      </p>
                      <ul className="mt-4 space-y-2">
                        {selectedDetail.lines.map((line) => (
                          <li
                            key={line}
                            className="text-sm leading-relaxed text-[var(--muted)]"
                          >
                            {line}
                          </li>
                        ))}
                      </ul>
                    </>
                  ) : (
                    <p className="text-sm leading-relaxed text-[var(--muted)]">
                      Tap a doctor, condition, or medicine to see details here.
                    </p>
                  )}
                </aside>
              </div>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-12">
              <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Treatment plans
              </h2>
              <div className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {p.treatments.map((t, i) => (
                  <article
                    key={t.id}
                    className="rounded-2xl bg-[var(--paper)] px-4 py-4"
                  >
                    <p className="font-display font-bold text-[var(--ink)]">
                      {t.name}
                    </p>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      Started {t.started}
                    </p>
                    <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                      {t.detail}
                    </p>
                  </article>
                ))}
                {!p.treatments.length && (
                  <p className="text-sm text-[var(--muted)]">No treatments listed.</p>
                )}
              </div>
            </section>

            {!!medicineUpdates.length && (
              <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-12">
                <h2 className="font-display text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                  Medicine checks
                </h2>
                <ul className="mt-5 grid gap-3 sm:grid-cols-2">
                  {medicineUpdates.slice(0, 4).map((e) => (
                    <li
                      key={e.id}
                      className="rounded-2xl bg-[var(--paper)] px-4 py-3"
                    >
                      <p className="text-xs text-[var(--muted)]">
                        {new Date(e.timestamp).toLocaleDateString()}
                      </p>
                      <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                        {e.actor_label}
                      </p>
                      <p className="mt-1 text-sm text-[var(--muted)]">{e.detail}</p>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </div>
        )}
      </div>
    </main>
  );
}

function LabBars({ reports }: { reports: Report[] }) {
  const bars = useMemo(() => {
    return reports
      .map((r) => {
        const value = parseLabValue(r.value);
        if (value == null) return null;
        return { id: r.id, title: r.title, value, unit: r.unit };
      })
      .filter(Boolean) as { id: string; title: string; value: number; unit: string }[];
  }, [reports]);

  if (!bars.length) {
    return (
      <p className="mt-6 text-sm text-[var(--muted)]">
        Lab values will appear here when results are ready.
      </p>
    );
  }

  const max = Math.max(...bars.map((b) => b.value), 1);
  const w = 480;
  const h = 160;
  const pad = 16;
  const gap = 12;
  const barW = (w - pad * 2 - gap * (bars.length - 1)) / bars.length;

  return (
    <div className="mt-5 overflow-x-auto">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        className="h-40 w-full min-w-[280px]"
        role="img"
        aria-label="Lab values chart"
      >
        {bars.map((b, i) => {
          const bh = Math.max(8, (b.value / max) * (h - 48));
          const x = pad + i * (barW + gap);
          const y = h - 28 - bh;
          return (
            <g key={b.id}>
              <rect
                x={x}
                y={y}
                width={barW}
                height={bh}
                rx={8}
                fill={["#0F766E", "#1D4ED8", "#B45309", "#7C3AED"][i % 4]}
                opacity={0.9}
              />
              <text
                x={x + barW / 2}
                y={y - 6}
                textAnchor="middle"
                className="fill-[var(--ink)]"
                style={{ fontSize: 11, fontWeight: 700 }}
              >
                {b.value}
              </text>
              <text
                x={x + barW / 2}
                y={h - 10}
                textAnchor="middle"
                className="fill-[var(--muted)]"
                style={{ fontSize: 10 }}
              >
                {b.title.length > 10 ? `${b.title.slice(0, 9)}…` : b.title}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
