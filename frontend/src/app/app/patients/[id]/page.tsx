"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import { CareGraph } from "@/components/CareGraph";
import { startVisitRecording, type VisitRecorder } from "@/lib/wavRecorder";
import type {
  Briefing,
  OfficeCall,
  PatientBundle,
  PresenceUser,
  RxAnalysis,
} from "@/lib/types";

const TABS = ["Overview", "History", "Treatments", "Team", "Talk", "Calls"] as const;
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
  const searchParams = useSearchParams();
  const [data, setData] = useState<PatientBundle | null>(null);
  const [tab, setTab] = useState<Tab>("Overview");
  const [msg, setMsg] = useState("");
  const [talkChannel, setTalkChannel] = useState<"team" | "private">("team");
  const [note, setNote] = useState("");
  const [briefing, setBriefing] = useState<Briefing | null>(null);
  const [presence, setPresence] = useState<PresenceUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [visitOut, setVisitOut] = useState<string | null>(null);
  const [visitSource, setVisitSource] = useState<string | null>(null);
  const [officeCalls, setOfficeCalls] = useState<OfficeCall[]>([]);
  const [callBusy, setCallBusy] = useState(false);
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

  useEffect(() => {
    const t = searchParams.get("tab");
    if (t && (TABS as readonly string[]).includes(t)) {
      setTab(t as Tab);
    }
  }, [searchParams]);

  const applyBundle = useCallback((b: PatientBundle) => {
    setData(b);
    if (b.briefing) setBriefing(b.briefing);
    if (b.presence) setPresence(b.presence);
    if (b.office_calls) setOfficeCalls(b.office_calls);
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
    if (!token || !msg.trim() || !data) return;
    setBusy(true);
    try {
      const privateToPatient =
        talkChannel === "private"
          ? { to_id: data.patient.id, to_label: data.patient.label }
          : undefined;
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(
          JSON.stringify({
            type: "message",
            text: msg.trim(),
            to_id: privateToPatient?.to_id ?? null,
            to_label: privateToPatient?.to_label ?? null,
          })
        );
        setMsg("");
        setTab("Talk");
      } else {
        const res = await api.postMessage(
          id,
          msg.trim(),
          token,
          privateToPatient
        );
        setMsg("");
        if (res.briefing) setBriefing(res.briefing);
        setData((d) => (d ? { ...d, room: res.room, briefing: res.briefing } : d));
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
    if (!token || !user) return;
    setBusy(true);
    setVisitOut(null);
    try {
      const doctorId = user.kind === "doctor" ? user.id : "doctor_a";
      const reason = "Symptoms and checkup request while doctor unavailable";
      const res = audio
        ? await api.officeCallAudio(id, { doctor_id: doctorId, reason }, audio, token)
        : await api.officeCall(id, { doctor_id: doctorId, reason, demo: true }, token);
      setVisitOut(res.transcript);
      setVisitSource(String(res.call?.source || "demo"));
      setOfficeCalls(res.office_calls || []);
      await load();
      setTab("Calls");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save office call");
    } finally {
      setBusy(false);
    }
  }

  async function replyToCall(call: OfficeCall) {
    if (!token) return;
    setTalkChannel("private");
    setTab("Talk");
    setMsg(
      `Hi ${call.patient_label}, thanks for calling the office about ${call.topic.toLowerCase()}. `
    );
    try {
      await api.markCallResponded(call.id, token);
      setOfficeCalls((prev) =>
        prev.map((c) =>
          c.id === call.id ? { ...c, status: "responded" as const } : c
        )
      );
    } catch {
      /* non-blocking */
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

  async function stopRx(rxId: string, rxNameLabel: string) {
    if (!token || !id) return;
    const ok = window.confirm(
      `Mark ${rxNameLabel} as complete and remove it from the active list? Only you (the prescribing doctor) can do this.`
    );
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api.stopRx(id, rxId, token, "Course completed");
      setData((d) =>
        d
          ? {
              ...d,
              patient: res.patient,
              graph: res.graph,
              snapshot: res.snapshot,
              attention: res.attention,
              connections: res.connections ?? d.connections,
            }
          : d
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove medicine");
    } finally {
      setBusy(false);
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

  const allMessages = data.room?.messages || [];
  const teamMessages = allMessages.filter((m) => !m.to_id);
  const privateMessages = allMessages.filter((m) => {
    if (!user || user.kind !== "doctor") return false;
    // Inbound private from patient → this doctor, or this doctor's private replies → patient
    return (
      m.to_id === user.id ||
      (m.author_id === user.id && m.to_id === p.id)
    );
  });
  const talkMessages =
    talkChannel === "private" ? privateMessages : teamMessages;
  const privateUnread = privateMessages.filter(
    (m) => m.to_id === user?.id && m.author_id !== user?.id
  ).length;

  return (
    <main className="workspace w-full space-y-6">
      <section className="relative overflow-hidden rounded-[2rem] border border-[var(--line)] bg-gradient-to-br from-teal-50 via-white to-slate-50 p-5 shadow-[0_20px_50px_rgba(15,23,42,0.07)] sm:p-7">
        <div
          className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-teal-200/30 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-24 left-1/3 h-48 w-48 rounded-full bg-sky-200/25 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0 flex-1">
            <Link
              href="/app/patients"
              className="text-sm font-semibold text-[var(--brand)]"
            >
              ← Patients
            </Link>
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand)]">
              Shared chart
            </p>
            <h1 className="font-display mt-2 text-[clamp(2rem,3.5vw,3rem)] font-extrabold tracking-tight text-[var(--ink)]">
              {p.label}
            </h1>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Age {p.age}
              {data.connections?.bond_score != null
                ? ` · team bond ${data.connections.bond_score}`
                : ""}
            </p>

            <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
              {(p.phone || p.email) && (
                <div className="rounded-2xl border border-white/80 bg-white/80 px-3.5 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)] backdrop-blur">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                    Contact
                  </p>
                  {p.phone ? (
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                      {p.phone}
                    </p>
                  ) : null}
                  {p.email ? (
                    <p className="mt-0.5 break-all text-xs text-[var(--muted)]">
                      {p.email}
                    </p>
                  ) : null}
                </div>
              )}
              {(p.address || p.city) && (
                <div className="rounded-2xl border border-white/80 bg-white/80 px-3.5 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.04)] backdrop-blur sm:col-span-1 xl:col-span-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                    Address
                  </p>
                  {p.address ? (
                    <p className="mt-1 text-sm font-semibold text-[var(--ink)]">
                      {p.address}
                    </p>
                  ) : null}
                  <p className="mt-0.5 text-xs text-[var(--muted)]">
                    {[p.city, p.state, p.zip].filter(Boolean).join(", ")}
                  </p>
                </div>
              )}
            </div>

            {presence.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <span className="text-xs font-semibold text-emerald-700">
                  Here now
                </span>
                {presence.map((u) => (
                  <span
                    key={u.id}
                    className="rounded-xl border border-emerald-200/80 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-900"
                  >
                    {u.label}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div className="flex gap-2 text-center text-sm">
            {[
              ["Conditions", data.snapshot.conditions],
              ["Medicines", data.snapshot.active_prescriptions],
              ["Treatments", data.snapshot.treatments],
            ].map(([k, v]) => (
              <div
                key={String(k)}
                className="min-w-[88px] rounded-2xl border border-white/80 bg-white/90 px-3 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.06)] backdrop-blur"
              >
                <p className="text-xs text-[var(--muted)]">{k}</p>
                <p className="font-display text-xl font-bold text-[var(--ink)]">
                  {v}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {briefing && (
        <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Team briefing
              </p>
              <h2 className="font-display mt-2 text-xl font-bold text-[var(--ink)]">
                {briefing.issue?.toLowerCase().includes("aligned")
                  ? `Care plan for ${data.patient.label}`
                  : briefing.issue}
              </h2>
            </div>
            <button
              onClick={refreshBrief}
              disabled={busy}
              className="rounded-xl border border-[var(--line)] px-3 py-1.5 text-xs font-semibold text-[var(--ink)] transition hover:border-teal-700/40"
            >
              Refresh
            </button>
          </div>
          <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-[var(--paper)] px-3 py-3">
              <dt className="text-xs text-[var(--muted)]">Owner</dt>
              <dd className="mt-1 font-medium text-[var(--ink)]">
                {briefing.owner}
              </dd>
            </div>
            <div className="rounded-2xl bg-[var(--paper)] px-3 py-3">
              <dt className="text-xs text-[var(--muted)]">Next step</dt>
              <dd className="mt-1 font-medium text-[var(--ink)]">
                {briefing.next_step}
              </dd>
            </div>
          </dl>
        </section>
      )}

      {!!(data.team_activity?.length ||
        data.attention?.flags?.some((f) => f.code !== "open_question")) && (
        <section className="grid gap-4 lg:grid-cols-2">
          {!!data.attention?.flags?.filter((f) => f.code !== "open_question")
            .length && (
            <div className="rounded-[1.75rem] border border-[var(--line)] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Things to watch
              </p>
              <ul className="mt-4 space-y-2">
                {data.attention!.flags
                  .filter((f) => f.code !== "open_question")
                  .map((f) => (
                  <li
                    key={f.code + f.title}
                    className={`rounded-xl border px-3 py-2 text-sm ${attentionClass(
                      f.level
                    )}`}
                  >
                    <p className="font-semibold">{f.title}</p>
                    <p className="mt-0.5 text-xs opacity-90">{f.detail}</p>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {!!data.team_activity?.length && (
            <div className="rounded-[1.75rem] border border-[var(--line)] bg-white p-5 shadow-[0_16px_40px_rgba(15,23,42,0.05)]">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Who has been here
              </p>
              <ul className="mt-4 space-y-2">
                {data.team_activity.slice(0, 6).map((t) => (
                  <li
                    key={t.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-[var(--paper)] px-3 py-2.5 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold text-[var(--ink)]">
                        {t.label}
                        {t.viewing_now && (
                          <span className="ml-2 text-[10px] font-bold uppercase text-emerald-700">
                            live
                          </span>
                        )}
                      </p>
                      <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-[var(--muted)]">
                        {t.detail}
                      </p>
                    </div>
                    <span className="shrink-0 text-[10px] text-[var(--muted)]">
                      {t.at ? new Date(t.at).toLocaleTimeString() : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {error && (
        <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
          {error}
        </p>
      )}

      <nav className="flex w-full flex-wrap gap-1 rounded-2xl border border-[var(--line)] bg-white p-1.5 shadow-[0_8px_20px_rgba(15,23,42,0.04)]">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`rounded-xl px-3 py-2 text-sm font-semibold sm:px-4 ${
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
                  <li
                    key={rx.id}
                    className="flex items-start justify-between gap-3 rounded-xl bg-slate-50 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0">
                      <p className="font-semibold">
                        {rx.name}{" "}
                        <span className="font-normal text-[var(--muted)]">{rx.dose}</span>
                      </p>
                      <p className="text-xs text-[var(--muted)]">
                        {doctorName(rx.prescribed_by)} · {rx.reason}
                      </p>
                    </div>
                    {user?.kind === "doctor" && user.id === rx.prescribed_by && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => stopRx(rx.id, rx.name)}
                        className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-900"
                      >
                        Course done
                      </button>
                    )}
                  </li>
                ))}
            </ul>
            {user?.kind === "doctor" && (
              <p className="mt-3 text-[11px] text-[var(--muted)]">
                Only the doctor who prescribed a medicine can mark it complete and
                remove it from the active list.
              </p>
            )}
          </section>
          <section className="card p-5 lg:col-span-2 2xl:col-span-1">
            <h2 className="font-display text-lg font-bold">Care connections</h2>
            <p className="mb-3 text-sm text-[var(--muted)]">
              {data.connections?.headline}
            </p>
            <CareGraph graph={data.graph} heightClass="h-[520px]" />
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
                    {rx.stopped ? ` · stopped ${rx.stopped}` : ""}
                  </p>
                  {user?.kind === "doctor" &&
                    user.id === rx.prescribed_by &&
                    rx.status === "active" && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => stopRx(rx.id, rx.name)}
                        className="mt-2 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-900"
                      >
                        Course done — remove
                      </button>
                    )}
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
                    <li
                      key={rx.id}
                      className="flex items-start justify-between gap-3 rounded-xl border border-[var(--line)] px-3 py-2 text-sm"
                    >
                      <div className="min-w-0">
                        <p className="font-semibold">
                          {rx.name}{" "}
                          <span className="font-normal text-[var(--muted)]">{rx.dose}</span>
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {doctorName(rx.prescribed_by)} · {rx.reason}
                        </p>
                      </div>
                      {user?.kind === "doctor" && user.id === rx.prescribed_by && (
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => stopRx(rx.id, rx.name)}
                          className="shrink-0 rounded-lg border border-[var(--line)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ink)] transition hover:border-rose-300 hover:bg-rose-50 hover:text-rose-900"
                        >
                          Course done
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          </section>

          {user?.kind === "doctor" ? (
            <section className="card p-5">
              <h2 className="font-display text-lg font-bold">Propose a prescription</h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                Draft a medicine, then Analyze safety. ClearPath checks the shared chart
                plus published drug references (NIH RxNav interactions and OpenFDA
                label warnings) for dangerous overlaps before you add it for the whole team.
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
                  {!!rxAnalysis.online_sources?.length && (
                    <p className="mt-2 text-[11px] text-[var(--muted)]">
                      Checked online: {rxAnalysis.online_sources.join(", ")}
                    </p>
                  )}
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
            <h2 className="font-display text-lg font-bold">Talk</h2>
            <p className="text-sm text-[var(--muted)]">
              Shared care-team chat, plus private messages with {p.label}
            </p>
            <div className="mt-3 flex flex-wrap gap-1 rounded-xl bg-[var(--paper)] p-1">
              <button
                type="button"
                onClick={() => setTalkChannel("team")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  talkChannel === "team"
                    ? "bg-white text-[var(--ink)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                Team room
              </button>
              <button
                type="button"
                onClick={() => setTalkChannel("private")}
                className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition ${
                  talkChannel === "private"
                    ? "bg-white text-[var(--ink)] shadow-sm"
                    : "text-[var(--muted)] hover:text-[var(--ink)]"
                }`}
              >
                Patient private
                {privateUnread > 0 && talkChannel !== "private" ? (
                  <span className="ml-1.5 rounded-full bg-teal-700 px-1.5 py-0.5 text-[10px] font-bold text-white">
                    {privateUnread}
                  </span>
                ) : null}
              </button>
            </div>
            <p className="mt-2 text-xs text-[var(--muted)]">
              {talkChannel === "team"
                ? "Visible to the full care team. Live sync refreshes the team briefing."
                : `Only you and ${p.label}. Messages they send to you land here.`}
            </p>
          </div>
          <div className="max-h-[360px] space-y-3 overflow-y-auto px-5 py-4">
            {talkMessages.map((m) => (
              <div
                key={m.id}
                className={`rounded-xl px-3 py-2 text-sm ${
                  talkChannel === "private"
                    ? "border border-teal-100 bg-teal-50/60"
                    : "bg-slate-50"
                }`}
              >
                <div className="flex justify-between text-xs text-[var(--muted)]">
                  <span className="font-semibold text-[var(--ink)]">
                    {m.author_label}
                    {m.to_label ? (
                      <span className="ml-1.5 font-normal text-[var(--muted)]">
                        → {m.to_label}
                      </span>
                    ) : talkChannel === "team" ? (
                      <span className="ml-1.5 font-normal text-[var(--muted)]">
                        → Care team
                      </span>
                    ) : null}
                  </span>
                  <span>{new Date(m.timestamp).toLocaleTimeString()}</span>
                </div>
                <p className="mt-1">{m.text}</p>
              </div>
            ))}
            {!talkMessages.length && (
              <p className="text-sm text-[var(--muted)]">
                {talkChannel === "private"
                  ? `${p.label} has not sent you a private message yet. Replies you send here stay between you two.`
                  : "No team messages yet. Start the huddle."}
              </p>
            )}
          </div>
          <div className="flex gap-2 border-t border-[var(--line)] p-4">
            <input
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && send()}
              placeholder={
                talkChannel === "private"
                  ? `Private reply to ${p.label}…`
                  : "Message the care team…"
              }
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

      {tab === "Calls" && (
        <section className="space-y-4">
          <div className="card p-5 space-y-4">
            <h2 className="font-display text-lg font-bold">Office calls</h2>
            <p className="text-sm text-[var(--muted)]">
              When you are unavailable, the patient calls your office. A health
              assistant takes the conversation, then ClearPath sends you an
              insight so you can reply in Patient private chat.
            </p>
            {user?.kind === "doctor" && (
              <div className="flex flex-wrap items-center gap-3">
                {recording ? (
                  <button
                    type="button"
                    onClick={stopRecording}
                    className="flex items-center gap-2.5 rounded-xl bg-rose-600 px-4 py-2.5 text-sm font-bold text-white"
                  >
                    <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-white" />
                    Stop and send to Muse · {Math.floor(recSeconds / 60)}:
                    {String(recSeconds % 60).padStart(2, "0")}
                  </button>
                ) : (
                  <button
                    type="button"
                    disabled={busy || callBusy}
                    onClick={startRecording}
                    className="flex items-center gap-2.5 rounded-xl bg-[var(--ink)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-50"
                  >
                    <span className="h-2.5 w-2.5 rounded-full bg-rose-500" />
                    {busy ? "Transcribing with Muse…" : "Record office call"}
                  </button>
                )}
                {!recording && (
                  <button
                    type="button"
                    disabled={busy || callBusy}
                    onClick={() => runVisitDemo()}
                    className="rounded-xl border border-[var(--line)] px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Use demo call
                  </button>
                )}
                <span className="text-xs text-[var(--muted)]">
                  {data.muse?.enabled
                    ? "Meta Muse Voice transcribes the recording."
                    : "Muse key not set, recordings fall back to a demo transcript."}
                </span>
              </div>
            )}
          </div>

          {(officeCalls.length ? officeCalls : data.office_calls || [])
            .filter((c) => !user || user.kind !== "doctor" || c.doctor_id === user.id)
            .map((call) => (
              <article
                key={call.id}
                className={`card p-5 ${
                  call.status === "new"
                    ? "border-teal-300/80 ring-1 ring-teal-200/60"
                    : ""
                }`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                      {call.status === "new"
                        ? "Needs your review"
                        : call.status === "responded"
                          ? "Responded"
                          : "Read"}
                    </p>
                    <h3 className="font-display mt-1 text-lg font-bold text-[var(--ink)]">
                      {call.topic}
                    </h3>
                    <p className="mt-1 text-xs text-[var(--muted)]">
                      {call.assistant_label} · {call.doctor_label}&apos;s office ·{" "}
                      {new Date(call.created_at).toLocaleString()}
                      {call.source === "muse_voice" && (
                        <span className="ml-2 rounded-full bg-violet-100 px-2 py-0.5 font-semibold text-violet-700">
                          Recorded · Muse Voice
                        </span>
                      )}
                    </p>
                  </div>
                  {user?.kind === "doctor" && user.id === call.doctor_id && (
                    <button
                      type="button"
                      onClick={() => replyToCall(call)}
                      className="rounded-xl bg-[var(--brand)] px-3 py-2 text-xs font-bold text-white"
                    >
                      Reply in private chat
                    </button>
                  )}
                </div>
                <p className="mt-4 rounded-2xl bg-teal-50/80 px-4 py-3 text-sm font-medium text-teal-950">
                  {call.insight}
                </p>
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs font-semibold text-[var(--muted)]">
                    Full assistant ↔ patient conversation
                  </summary>
                  <p className="mt-2 whitespace-pre-line rounded-xl bg-[var(--paper)] px-3 py-3 text-sm text-[var(--ink)]">
                    {call.transcript}
                  </p>
                </details>
              </article>
            ))}

          {!officeCalls.length && !(data.office_calls || []).length && (
            <p className="text-sm text-[var(--muted)]">
              No office calls yet. When {p.label} calls while you are away, the
              insight will show here.
            </p>
          )}

          {visitOut && (
            <div className="card p-4 text-sm">
              <p className="text-xs font-bold uppercase text-[var(--muted)]">
                Latest transcript ·{" "}
                {visitSource === "muse_voice" ? "Meta Muse Voice" : visitSource || "demo"}
              </p>
              <p className="mt-2 whitespace-pre-line">{visitOut}</p>
            </div>
          )}
        </section>
      )}
    </main>
  );
}
