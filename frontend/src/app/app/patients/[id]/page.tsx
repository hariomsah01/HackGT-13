"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import { CareGraph } from "@/components/CareGraph";
import { startVisitRecording, type VisitRecorder } from "@/lib/wavRecorder";
import type { Briefing, PatientBundle, PresenceUser, RxAnalysis } from "@/lib/types";

const TABS = ["Overview", "History", "Treatments", "Team", "Talk", "Visit"] as const;
type Tab = (typeof TABS)[number];

function attentionClass(level?: string) {
  if (level === "caution") return "bg-rose-50 text-rose-900 border-rose-200";
  if (level === "review") return "bg-amber-50 text-amber-950 border-amber-200";
  if (level === "handoff") return "bg-sky-50 text-sky-950 border-sky-200";
  return "bg-emerald-50 text-emerald-900 border-emerald-200";
}

function severityClass(sev?: string) {
  if (sev === "avoid") return "border-rose-300 bg-rose-50 text-rose-950";
  if (sev === "caution") return "border-amber-300 bg-amber-50 text-amber-950";
  if (sev === "review") return "border-sky-300 bg-sky-50 text-sky-950";
  return "border-emerald-300 bg-emerald-50 text-emerald-950";
}

export default function PatientRoomPage() {
  const { id } = useParams<{ id: string }>();
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [data, setData] = useState<PatientBundle | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [msg, setMsg] = useState("");
  const [note, setNote] = useState("");
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [visitOut, setVisitOut] = useState<string | null>(null);
  const [visitSource, setVisitSource] = useState<string | null>(null);
  const [recording, setRecording] = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef = useRef<VisitRecorder | null>(null);
  const [busy, setBusy] = useState(false);
  const [rxName, setRxName] = useState("");
  const [rxDose, setRxDose] = useState("");
  const [rxFreq, setRxFreq] = useState("");
  const [rxReason, setRxReason] = useState("");
  const [rxAnalysis, setRxAnalysis] = useState<RxAnalysis | null>(null);
  const [rxBusy, setRxBusy] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  const applyBundle = useCallback((b: PatientBundle) => {
    setData(b);
    if (b.briefing) setBriefing(b.briefing);
    if (b.presence) setPresence(b.presence);
  }, []);

  async function load() {
    if (!token || !id) return;
    applyBundle(await api.openPatient(id, token));
  }

  useEffect(() => {
    load().catch((e) => setError(String(e.message || e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  // Real-time WebSocket
  useEffect(() => {
    if (!token || !id) return;
    const ws = new WebSocket(api.wsUrl(id, token));
    wsRef.current = ws;
    ws.onmessage = (ev) => {
      try {
        const payload = JSON.parse(ev.data);
        if (payload.type === "presence") setPresence(payload.presence || []);
        if (payload.type === "room_update") {
          setData((d) =>
            d
              ? {
                  ...d,
                  room: payload.room,
                  briefing: payload.briefing,
                }
              : d
          );
          setBriefing(payload.briefing);
        }
        if (payload.type === "briefing") setBriefing(payload.briefing);
      } catch {
        /* ignore */
      }
    };
    const ping = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "ping" }));
    }, 15000);
    return () => {
      clearInterval(ping);
      ws.onmessage = null;
      if (ws.readyState === WebSocket.CONNECTING) {
        // Closing mid-handshake makes the browser log an error; close once it opens instead.
        ws.onerror = null;
        ws.onopen = () => ws.close();
      } else {
        ws.close();
      }
    };
  }, [token, id]);

  async function send() {
    if (!token || !msg.trim()) return;
    setBusy(true);
    try {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: "message", text: msg.trim() }));
        setMsg("");
        setTab("Talk");
      } else {
        const res = await api.postMessage(id, msg.trim(), token);
        setMsg("");
        setBriefing(res.briefing);
        await load();
        setTab("Talk");
      }
    } finally {
      setBusy(false);
    }
  }

  async function saveNote() {
    if (!token || !note.trim()) return;
    await api.addNote(id, note.trim(), token);
    setNote("");
    await load();
  }

  async function refreshBrief() {
    if (!token) return;
    setBusy(true);
    try {
      const b = await api.brief(id, token);
      setBriefing(b);
    } finally {
      setBusy(false);
    }
  }

  useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [recording]);

  useEffect(() => () => recorderRef.current?.cancel(), []);

  async function startRecording() {
    setError(null);
    try {
      recorderRef.current = await startVisitRecording();
      setRecSeconds(0);
      setRecording(true);
    } catch {
      setError("Microphone access was blocked — allow it in the browser address bar and try again.");
    }
  }

  async function stopRecording() {
    const rec = recorderRef.current;
    recorderRef.current = null;
    setRecording(false);
    if (!rec) return;
    const wav = await rec.stop();
    await runVisitDemo(wav);
  }

  async function runVisitDemo(audio?: Blob) {
    if (!token) return;
    setBusy(true);
    setVisitOut(null);
    try {
      const res = await api.captureVisit(id, token, audio);
      setVisitOut(res.transcript);
      setVisitSource(String(res.transcription?.source ?? ""));
      setBriefing(res.briefing);
      await load();
      setTab("Talk");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Visit capture failed");
    } finally {
      setBusy(false);
    }
  }

  async function runRxAnalyze() {
    if (!token || !rxName.trim() || !rxDose.trim()) return;
    setRxBusy(true);
    setError(null);
    try {
      const res = await api.analyzeRx(
        id,
        {
          name: rxName.trim(),
          dose: rxDose.trim(),
          frequency: rxFreq.trim(),
          reason: rxReason.trim(),
        },
        token
      );
      setRxAnalysis(res);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rx analysis failed");
    } finally {
      setRxBusy(false);
    }
  }

  async function commitRx() {
    if (!token || !rxName.trim() || !rxDose.trim()) return;
    setRxBusy(true);
    setError(null);
    try {
      await api.addRx(
        id,
        {
          name: rxName.trim(),
          dose: rxDose.trim(),
          frequency: rxFreq.trim(),
          reason: rxReason.trim(),
          analysis_severity: rxAnalysis?.severity,
        },
        token
      );
      setRxName("");
      setRxDose("");
      setRxFreq("");
      setRxReason("");
      setRxAnalysis(null);
      await load();
      setTab("Overview");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not add prescription");
    } finally {
      setRxBusy(false);
    }
  }

  useAskScreen(
    data
      ? {
          patient_id: id,
          patient: data.patient,
          briefing,
          presence,
          connections: data.connections,
          snapshot: data.snapshot,
          graph: data.graph,
          tasks: data.tasks,
          attention: data.attention,
          handoff: data.handoff,
          team_activity: data.team_activity,
          room_messages: (data.room?.messages || []).slice(-12),
          visit_transcript: visitOut,
          active_tab: tab,
          rx_draft: rxAnalysis
            ? { proposed: rxAnalysis.proposed, severity: rxAnalysis.severity }
            : null,
        }
      : {},
    !!data
  );

  if (!data) {
    return (
      <main className="workspace text-[var(--muted)]">
        {error || "Opening shared room…"}
      </main>
    );
  }

  const p = data.patient;
  const doctorName = (did: string) =>
    p.team.find((m) => m.id === did)?.label || did;

  return (
    <main className="workspace w-full space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link href="/app/patients" className="text-sm text-[var(--brand)]">
            ← Patients
          </Link>
          <h1 className="font-display mt-1 text-3xl font-bold">{p.label}</h1>
          <p className="text-sm text-[var(--muted)]">
            Age {p.age} · One chart for Doctors A–D · bond{" "}
            {data.connections?.bond_score ?? "—"}
          </p>
          {presence.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-emerald-700">Here now</span>
              {presence.map((u) => (
                <span
                  key={u.id}
                  className="rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-semibold text-emerald-900"
                >
                  {u.label}
                </span>
              ))}
            </div>
          )}
          {data.attention && data.attention.level !== "clear" && (
            <div
              className={`mt-3 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-xs font-semibold ${attentionClass(
                data.attention.level
              )}`}
            >
              <span>{data.attention.badge}</span>
              <span className="font-normal opacity-80">
                {data.attention.flags[0]?.title || "Team review"}
              </span>
            </div>
          )}
        </div>
        <div className="flex gap-2 text-center text-sm">
          {[
            ["Conditions", data.snapshot.conditions],
            ["Medicines", data.snapshot.active_prescriptions],
            ["Treatments", data.snapshot.treatments],
          ].map(([k, v]) => (
            <div key={String(k)} className="card min-w-[88px] px-3 py-2">
              <p className="text-xs text-[var(--muted)]">{k}</p>
              <p className="font-display text-xl font-bold">{v}</p>
            </div>
          ))}
        </div>
      </div>

      {briefing && (
        <section className="card border-teal-200 bg-gradient-to-br from-teal-50/80 to-white p-5">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-bold uppercase tracking-wider text-teal-800">
                Team briefing
              </p>
              <h2 className="font-display mt-1 text-xl font-bold">{briefing.issue}</h2>
            </div>
            <button
              onClick={refreshBrief}
              disabled={busy}
              className="rounded-full border border-teal-700/30 px-3 py-1 text-xs font-semibold text-teal-900"
            >
              Refresh
            </button>
          </div>
          <dl className="mt-3 grid gap-3 sm:grid-cols-3 text-sm">
            <div>
              <dt className="text-xs text-[var(--muted)]">Open question</dt>
              <dd className="font-medium">{briefing.open_question}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Owner</dt>
              <dd className="font-medium">{briefing.owner}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted)]">Next step</dt>
              <dd className="font-medium">{briefing.next_step}</dd>
            </div>
          </dl>
          <p className="mt-3 rounded-xl bg-white/80 px-3 py-2 text-sm text-[var(--muted)]">
            For the patient: {briefing.for_patient}
          </p>
        </section>
      )}

      {!!(data.team_activity?.length || data.attention?.flags?.length) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {!!data.attention?.flags?.length && (
            <div className="card p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                Shared chart attention
              </p>
              <ul className="mt-3 space-y-2">
                {data.attention.flags.map((f) => (
                  <li
                    key={f.code + f.title}
                    className={`rounded-lg border px-3 py-2 text-sm ${attentionClass(f.level)}`}
                  >
                    <p className="font-semibold">{f.title}</p>
                    <p className="mt-0.5 text-xs opacity-90">{f.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!data.team_activity?.length && (
            <div className="card p-4">
              <p className="text-xs font-bold uppercase tracking-wider text-[var(--muted)]">
                Who&apos;s been in this room
              </p>
              <ul className="mt-3 space-y-2">
                {data.team_activity.slice(0, 6).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 rounded-lg bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-semibold">
                        {t.label}
                        {t.viewing_now && (
                          <span className="ml-2 text-[10px] font-bold uppercase text-emerald-700">
                            live
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-[var(--muted)]">{t.detail}</p>
                    </div>
                    <span className="shrink-0 text-[10px] text-[var(--muted)]">
                      {t.at ? new Date(t.at).toLocaleTimeString() : "—"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {error && (
        <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
      )}

      <nav className="flex w-full flex-wrap gap-1 rounded-2xl border border-[var(--line)] bg-white p-1 sm:rounded-full">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold sm:px-4 ${
              tab === t ? "tab-active" : "tab-idle"
            }`}
          >
            {t}
          </button>
        ))}
      </nav>

      {tab === "Overview" && (
        <div className="grid gap-6 lg:grid-cols-2 2xl:grid-cols-3">
          <section className="card p-5">
            <h2 className="font-display text-lg font-bold">Conditions</h2>
            <ul className="mt-3 space-y-2">
              {p.conditions.map((c) => (
                <li key={c.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-semibold">{c.name}</p>
                  <p className="text-xs text-[var(--muted)]">
                    Since {c.since} · {c.note}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-5">
            <h2 className="font-display text-lg font-bold">Active medicines</h2>
            <ul className="mt-3 space-y-2">
              {p.prescriptions
                .filter((x) => x.status === "active")
                .map((rx) => (
                  <li key={rx.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                    <p className="font-semibold">
                      {rx.name}{" "}
                      <span className="font-normal text-[var(--muted)]">{rx.dose}</span>
                    </p>
                    <p className="text-xs text-[var(--muted)]">
                      {doctorName(rx.prescribed_by)} · {rx.reason}
                    </p>
                  </li>
                ))}
            </ul>
          </section>
          <section className="card p-5 lg:col-span-2 2xl:col-span-1">
            <h2 className="font-display text-lg font-bold">Care connections</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">
              {data.connections?.headline}
            </p>
            <CareGraph graph={data.graph} />
          </section>
        </div>
      )}

      {tab === "History" && (
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="card p-5">
            <h2 className="font-display text-lg font-bold">All medicines</h2>
            <ul className="mt-3 space-y-2">
              {p.prescriptions.map((rx) => (
                <li key={rx.id} className="border-b border-[var(--line)] py-2 text-sm">
                  <div className="flex justify-between gap-2">
                    <span className="font-semibold">{rx.name}</span>
                    <span className="text-xs uppercase text-[var(--muted)]">{rx.status}</span>
                  </div>
                  <p className="text-xs text-[var(--muted)]">
                    {rx.dose} · {doctorName(rx.prescribed_by)} · started {rx.started}
                  </p>
                </li>
              ))}
            </ul>
          </section>
          <section className="card p-5">
            <h2 className="font-display text-lg font-bold">Reports & notes</h2>
            <ul className="mt-3 space-y-2">
              {p.reports.map((r) => (
                <li key={r.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                  <p className="font-semibold">
                    {r.title}: {r.value} {r.unit}
                  </p>
                  <p className="text-xs text-[var(--muted)]">{r.date}</p>
                </li>
              ))}
            </ul>
            <ul className="mt-4 space-y-3">
              {p.notes.map((n) => (
                <li key={n.id} className="rounded-xl border border-[var(--line)] p-3 text-sm">
                  <p className="text-xs text-[var(--muted)]">
                    {n.author_label} · {n.date}
                  </p>
                  <p className="mt-1">{n.text}</p>
                </li>
              ))}
            </ul>
            {user?.kind === "doctor" && (
              <div className="mt-4 flex gap-2">
                <input
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a short note for the team…"
                  className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                />
                <button
                  onClick={saveNote}
                  className="rounded-xl bg-[var(--ink)] px-4 py-2 text-sm font-semibold text-white"
                >
                  Save
                </button>
              </div>
            )}
          </section>
        </div>
      )}

      {tab === "Treatments" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <section className="card p-5">
            <h2 className="font-display text-lg font-bold">Treatments & plans</h2>
            <ul className="mt-4 space-y-3">
              {p.treatments.map((t) => (
                <li key={t.id} className="rounded-xl bg-slate-50 px-4 py-3">
                  <div className="flex justify-between gap-2">
                    <p className="font-display text-lg font-bold">{t.name}</p>
                    <span className="text-xs font-bold uppercase text-[var(--muted)]">
                      {t.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-[var(--muted)]">{t.detail}</p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    Led by {doctorName(t.led_by)} · since {t.started}
                  </p>
                </li>
              ))}
            </ul>
            <div className="mt-5">
              <h3 className="font-display text-base font-bold">Active medicines</h3>
              <ul className="mt-3 space-y-2">
                {p.prescriptions
                  .filter((x) => x.status === "active")
                  .map((rx) => (
                    <li key={rx.id} className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm">
                      <p className="font-semibold">
                        {rx.name}{" "}
                        <span className="font-normal text-[var(--muted)]">{rx.dose}</span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {doctorName(rx.prescribed_by)} · {rx.reason}
                      </p>
                    </li>
                  ))}
              </ul>
            </div>
          </section>

          {user?.kind === "doctor" ? (
            <section className="card p-5">
              <h2 className="font-display text-lg font-bold">Propose a prescription</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Draft a medicine, run shared-chart safety analysis against conditions and
                other doctors&apos; Rx, then add it for the whole team.
              </p>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <label className="block text-sm sm:col-span-2">
                  <span className="text-xs font-semibold text-[var(--muted)]">Medicine</span>
                  <input
                    value={rxName}
                    onChange={(e) => setRxName(e.target.value)}
                    placeholder="e.g. Ibuprofen"
                    className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-teal-700"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-semibold text-[var(--muted)]">Dose</span>
                  <input
                    value={rxDose}
                    onChange={(e) => setRxDose(e.target.value)}
                    placeholder="400 mg"
                    className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-teal-700"
                  />
                </label>
                <label className="block text-sm">
                  <span className="text-xs font-semibold text-[var(--muted)]">Frequency</span>
                  <input
                    value={rxFreq}
                    onChange={(e) => setRxFreq(e.target.value)}
                    placeholder="twice daily"
                    className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-teal-700"
                  />
                </label>
                <label className="block text-sm sm:col-span-2">
                  <span className="text-xs font-semibold text-[var(--muted)]">Reason</span>
                  <input
                    value={rxReason}
                    onChange={(e) => setRxReason(e.target.value)}
                    placeholder="Why this medicine?"
                    className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-teal-700"
                  />
                </label>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  disabled={rxBusy || !rxName.trim() || !rxDose.trim()}
                  onClick={runRxAnalyze}
                  className="rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                >
                  {rxBusy ? "Analyzing…" : "Analyze safety"}
                </button>
                <button
                  type="button"
                  disabled={rxBusy || !rxName.trim() || !rxDose.trim() || !rxAnalysis}
                  onClick={commitRx}
                  className="rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
                >
                  Add to shared chart
                </button>
              </div>
              {!data.openai_rx?.enabled && (
                <p className="mt-3 text-xs text-[var(--muted)]">
                  Using built-in safety checks (set OPENAI_API_KEY for deeper analysis).
                </p>
              )}
              {rxAnalysis && (
                <div
                  className={`mt-4 rounded-xl border p-4 ${severityClass(rxAnalysis.severity)}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-display text-base font-bold capitalize">
                      {rxAnalysis.severity}
                    </p>
                    <span className="text-[10px] font-semibold uppercase opacity-70">
                      {rxAnalysis.engine || "analysis"}
                      {rxAnalysis.impacts_other_regimens ? " · other doctors" : ""}
                    </span>
                  </div>
                  <p className="mt-2 text-sm">{rxAnalysis.summary}</p>
                  <p className="mt-2 text-sm font-medium">{rxAnalysis.recommendation}</p>
                  {!!rxAnalysis.findings?.length && (
                    <ul className="mt-3 space-y-2">
                      {rxAnalysis.findings.map((f, i) => (
                        <li
                          key={`${f.title}-${i}`}
                          className="rounded-lg bg-white/70 px-3 py-2 text-sm"
                        >
                          <p className="font-semibold">
                            {f.title}
                            {f.affects_other_doctors && (
                              <span className="ml-2 text-[10px] font-bold uppercase text-amber-800">
                                cross-doctor
                              </span>
                            )}
                          </p>
                          <p className="mt-0.5 text-xs opacity-90">{f.detail}</p>
                          {!!f.related_doctors?.length && (
                            <p className="mt-1 text-[10px] text-[var(--muted)]">
                              Related: {f.related_doctors.join(", ")}
                            </p>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </section>
          ) : (
            <section className="card p-5 text-sm text-[var(--muted)]">
              Only doctors can propose prescriptions. You can still see the shared medicine
              list and treatments.
            </section>
          )}
        </div>
      )}

      {tab === "Team" && (
        <section className="card p-5 space-y-4">
          <h2 className="font-display text-lg font-bold">How close is the team?</h2>
          <p className="text-sm text-[var(--muted)]">
            Connection scores rise when doctors prescribe, lead treatments, write notes, or
            talk in the room — so the right people stay close to {p.label}.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(data.connections?.team_connection || []).map((m) => (
              <div key={m.id} className="rounded-xl border border-[var(--line)] p-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-lg font-bold">{m.label}</p>
                  <span className="text-sm font-bold text-teal-800">
                    {m.connection_score}
                  </span>
                </div>
                <p className="text-xs text-[var(--muted)]">
                  {m.specialty} · {m.closeness}
                </p>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-full rounded-full bg-[var(--brand)]"
                    style={{ width: `${m.connection_score}%` }}
                  />
                </div>
                <p className="mt-2 text-xs text-[var(--muted)]">
                  {m.reasons.join(" · ")}
                </p>
              </div>
            ))}
          </div>
          {!!data.connections?.bridges?.length && (
            <div className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-950">
              {data.connections.bridges.map((b) => (
                <p key={b.type}>{b.why}</p>
              ))}
            </div>
          )}
          <CareGraph graph={data.graph} />
          {!!data.tasks?.length && (
            <div>
              <h3 className="font-display text-base font-bold">Open team steps</h3>
              <ul className="mt-2 space-y-2 text-sm">
                {data.tasks.map((t) => (
                  <li key={t.id} className="rounded-xl bg-slate-50 px-3 py-2">
                    <strong>{t.owner_label}</strong> — {t.task}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {tab === "Talk" && (
        <section className="card overflow-hidden">
          <div className="border-b border-[var(--line)] px-5 py-4">
            <h2 className="font-display text-lg font-bold">Team room</h2>
            <p className="text-sm text-[var(--muted)]">
              Live sync · messages refresh the team briefing automatically
            </p>
          </div>
          <div className="max-h-[360px] space-y-3 overflow-y-auto px-5 py-4">
            {(data.room?.messages || []).map((m) => (
              <div key={m.id} className="rounded-xl bg-slate-50 px-3 py-2 text-sm">
                <div className="flex justify-between text-xs text-[var(--muted)]">
                  <span className="font-semibold text-[var(--ink)]">
                    {m.author_label}
                    {m.to_label ? (
                      <span className="ml-1.5 font-normal text-[var(--muted)]">
                        → {m.to_label}
                      </span>
                    ) : null}
                  </span>
                  <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1">{m.text}</p>
              </div>
            ))}
            {!data.room?.messages?.length && (
              <p className="text-sm text-[var(--muted)]">
                No messages yet. Start the huddle.
              </p>
            )}
          </div>
          <div className="flex gap-2 border-t border-[var(--line)] p-4">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder="Message the care team…"
              className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
            />
            <button
              onClick={send}
              disabled={busy}
              className="rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </section>
      )}

      {tab === "Visit" && (
        <section className="card p-5 space-y-4">
          <h2 className="font-display text-lg font-bold">Capture a visit</h2>
          <p className="text-sm text-[var(--muted)]">
            Record the conversation in the room. Speech becomes a shared note the whole team
            can see — so the patient never has to retell what was said.
          </p>
          {user?.kind === "doctor" ? (
            <div className="flex flex-wrap items-center gap-3">
              {recording ? (
                <button
                  onClick={stopRecording}
                  className="flex items-center gap-2.5 rounded-xl bg-rose-600 px-5 py-3 text-sm font-bold text-white"
                >
                  <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                  Stop and save · {Math.floor(recSeconds / 60)}:
                  {String(recSeconds % 60).padStart(2, "0")}
                </button>
              ) : (
                <button
                  onClick={startRecording}
                  disabled={busy}
                  className="flex items-center gap-2.5 rounded-xl bg-[var(--ink)] px-5 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                  {busy ? "Transcribing…" : "Record visit"}
                </button>
              )}
              {!recording && (
                <button
                  onClick={() => runVisitDemo()}
                  disabled={busy}
                  className="rounded-xl border border-[var(--line)] px-4 py-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  Use demo visit
                </button>
              )}
            </div>
          ) : (
            <p className="text-sm text-[var(--muted)]">Only doctors can capture visits.</p>
          )}
          {visitOut && (
            <div className="rounded-xl bg-slate-50 p-4 text-sm">
              <p className="text-xs font-bold uppercase text-[var(--muted)]">
                Transcript{visitSource === "muse_voice" ? " · Muse Voice" : " · demo"}
              </p>
              <p className="mt-2 whitespace-pre-line">{visitOut}</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
