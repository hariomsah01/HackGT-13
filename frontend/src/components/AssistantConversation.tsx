"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { startListening, type Listener } from "@/lib/wavRecorder";
import type { AssistantTurnResult, CareRoom, FdaRef, OfficeCall } from "@/lib/types";

type Turn = {
  role: "assistant" | "user";
  text: string;
  source?: string;
  pending?: boolean;
  fda?: FdaRef[];
};
type Phase = "idle" | "connecting" | "listening" | "transcribing" | "thinking" | "speaking";

export type AssistantRecipient = { id: string; label: string; detail?: string; online?: boolean };

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};

const PHASE_LABEL: Record<Phase, string> = {
  idle: "Ready",
  connecting: "Connecting to Ava…",
  listening: "Listening",
  transcribing: "Muse Voice is transcribing…",
  thinking: "Ava is thinking…",
  speaking: "Ava is speaking",
};

const BARS = 28;

function femaleVoice(): SpeechSynthesisVoice | undefined {
  const voices = window.speechSynthesis?.getVoices() ?? [];
  const en = voices.filter((v) => v.lang.toLowerCase().startsWith("en"));
  const gb = en.filter((v) => v.lang.toLowerCase().replace("_", "-") === "en-gb");
  const preferred = ["Google UK English Female", "Sonia", "Libby", "Hazel", "Serena", "Kate", "Stephanie", "Martha", "Female"];
  for (const name of preferred) {
    const v = gb.find((x) => x.name.includes(name)) || en.find((x) => x.name.includes(name));
    if (v) return v;
  }
  return gb.find((v) => !/male/i.test(v.name) || /female/i.test(v.name)) || gb[0] || en[0];
}

export function AssistantConversation({
  mode,
  patientId,
  patientLabel,
  recipients = [],
  tts = "browser",
  medicines = [],
  seed = null,
  onSubmitted,
  onSent,
}: {
  mode: "patient" | "doctor";
  patientId: string;
  patientLabel: string;
  recipients?: AssistantRecipient[];
  tts?: "elevenlabs" | "browser";
  medicines?: string[];
  /** Question handed to Ava from elsewhere on the page (for example the medicine info panel). */
  seed?: { text: string; nonce: number } | null;
  onSubmitted?: (res: { call: OfficeCall; room: CareRoom; office_calls: OfficeCall[] }) => void;
  onSent?: (room: CareRoom) => void;
}) {
  const { token } = useAuth();
  const [phase, setPhase] = useState<Phase>("idle");
  const [active, setActive] = useState(false);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [handsFree, setHandsFree] = useState(true);
  const [levels, setLevels] = useState<number[]>(() => Array(BARS).fill(0));
  const [caption, setCaption] = useState("");
  const [typed, setTyped] = useState("");
  const [ready, setReady] = useState(false);
  const [urgent, setUrgent] = useState(false);
  const [draft, setDraft] = useState("");
  const [draftEdited, setDraftEdited] = useState(false);
  const [includeVoice, setIncludeVoice] = useState(true);
  const [recipient, setRecipient] = useState("team");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voiceUsed, setVoiceUsed] = useState<"elevenlabs" | "browser">(tts);

  const listenerRef = useRef<Listener | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const recogRef = useRef<SpeechRecognitionLike | null>(null);
  const captionRef = useRef("");
  const activeRef = useRef(false);
  const handsFreeRef = useRef(true);
  const turnsRef = useRef<Turn[]>([]);
  const draftRef = useRef("");
  const draftEditedRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const interruptRef = useRef(0);

  const recipientLabel =
    mode === "doctor"
      ? patientLabel
      : recipient === "team"
        ? "your full care team"
        : recipients.find((r) => r.id === recipient)?.label || "your doctor";
  const userTurns = turns.filter((t) => t.role === "user" && !t.pending).length;

  useEffect(() => {
    handsFreeRef.current = handsFree;
  }, [handsFree]);
  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    draftEditedRef.current = draftEdited;
  }, [draftEdited]);
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [turns, caption]);
  useEffect(() => {
    window.speechSynthesis?.getVoices();
    return () => {
      activeRef.current = false;
      listenerRef.current?.cancel();
      audioRef.current?.pause();
      window.speechSynthesis?.cancel();
      recogRef.current?.stop();
    };
  }, []);

  function commitTurns(next: Turn[]) {
    turnsRef.current = next;
    setTurns(next);
  }

  function pushLevel(level: number) {
    setLevels((prev) => [...prev.slice(1), level]);
  }

  function stopSpeaking() {
    interruptRef.current += 1;
    audioRef.current?.pause();
    audioRef.current = null;
    window.speechSynthesis?.cancel();
  }

  function speak(res: Pick<AssistantTurnResult, "reply" | "audio_b64" | "audio_mime">) {
    setPhase("speaking");
    return new Promise<void>((resolve) => {
      if (res.audio_b64) {
        setVoiceUsed("elevenlabs");
        const audio = new Audio(`data:${res.audio_mime || "audio/mpeg"};base64,${res.audio_b64}`);
        audioRef.current = audio;
        audio.onended = () => resolve();
        audio.onerror = () => resolve();
        audio.onpause = () => resolve();
        audio.play().catch(() => resolve());
        return;
      }
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      setVoiceUsed("browser");
      const utter = new SpeechSynthesisUtterance(res.reply);
      const voice = femaleVoice();
      utter.lang = "en-GB";
      if (voice) utter.voice = voice;
      utter.rate = 1.0;
      utter.pitch = 1.05;
      utter.onend = () => resolve();
      utter.onerror = () => resolve();
      synth.cancel();
      synth.speak(utter);
    });
  }

  function startCaptions() {
    const w = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    captionRef.current = "";
    setCaption("");
    if (!SR) return;
    try {
      const r = new SR();
      r.continuous = true;
      r.interimResults = true;
      r.lang = "en-US";
      r.onresult = (e) => {
        let text = "";
        for (let i = 0; i < e.results.length; i++) text += e.results[i][0].transcript;
        captionRef.current = text.trim();
        setCaption(captionRef.current);
      };
      r.onerror = () => {};
      r.start();
      recogRef.current = r;
    } catch {
      recogRef.current = null;
    }
  }

  function stopCaptions() {
    try {
      recogRef.current?.stop();
    } catch {
      /* already stopped */
    }
    recogRef.current = null;
  }

  async function afterReply(res: AssistantTurnResult) {
    const turnId = interruptRef.current;
    await speak(res);
    if (!activeRef.current || interruptRef.current !== turnId) return;
    if (handsFreeRef.current && !res.ready) {
      await listen();
    } else {
      setPhase("idle");
    }
  }

  async function runTurn(input: { audio?: Blob; text?: string; hint?: string }) {
    if (!token) return;
    setError(null);
    const history = turnsRef.current.filter((t) => !t.pending).map(({ role, text }) => ({ role, text }));
    const pendingText = input.text ?? (input.hint || "…");
    commitTurns([
      ...turnsRef.current,
      { role: "user", text: pendingText, pending: !input.text, source: input.text ? "typed" : undefined },
    ]);
    setPhase(input.audio ? "transcribing" : "thinking");
    try {
      const res = await api.assistantTurn(
        patientId,
        {
          mode,
          history,
          text: input.text,
          hint: input.hint,
          audio: input.audio,
          recipient,
          draft: draftRef.current,
        },
        token
      );
      const settled = turnsRef.current.map((t) =>
        t.pending ? { role: "user" as const, text: res.user_text, source: res.user_source } : t
      );
      commitTurns([...settled, { role: "assistant", text: res.reply, fda: res.fda_refs }]);
      setReady(res.ready);
      if (res.urgent) setUrgent(true);
      if (mode === "doctor" && res.draft && !draftEditedRef.current) setDraft(res.draft);
      await afterReply(res);
    } catch (e) {
      commitTurns(turnsRef.current.filter((t) => !t.pending));
      setError(e instanceof Error ? e.message : "Ava could not respond");
      setPhase("idle");
    }
  }

  async function listen() {
    stopSpeaking();
    setError(null);
    try {
      listenerRef.current = await startListening({
        onLevel: pushLevel,
        onSilence: () => {
          void finishListening();
        },
      });
      setPhase("listening");
      startCaptions();
    } catch {
      setError("Microphone access was blocked. Allow it in the address bar, or type below.");
      setPhase("idle");
    }
  }

  async function finishListening() {
    const l = listenerRef.current;
    if (!l) return;
    listenerRef.current = null;
    stopCaptions();
    const spoke = l.heardSpeech();
    const wav = await l.stop();
    setLevels(Array(BARS).fill(0));
    const hint = captionRef.current;
    setCaption("");
    if (!spoke && !hint) {
      setError("Ava didn't hear anything. Tap the mic and try again, or type below.");
      setPhase("idle");
      return;
    }
    await runTurn({ audio: wav, hint });
  }

  async function start() {
    if (!token) return;
    activeRef.current = true;
    setActive(true);
    commitTurns([]);
    setResult(null);
    setError(null);
    setReady(false);
    setUrgent(false);
    setDraft("");
    setDraftEdited(false);
    setPhase("connecting");
    try {
      const res = await api.assistantTurn(patientId, { mode, history: [], recipient }, token);
      commitTurns([{ role: "assistant", text: res.reply }]);
      await afterReply(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach Ava");
      setPhase("idle");
      activeRef.current = false;
      setActive(false);
    }
  }

  function end() {
    activeRef.current = false;
    setActive(false);
    listenerRef.current?.cancel();
    listenerRef.current = null;
    stopSpeaking();
    stopCaptions();
    setLevels(Array(BARS).fill(0));
    setCaption("");
    setPhase("idle");
  }

  async function onMic() {
    if (!active) return start();
    if (phase === "listening") return finishListening();
    if (phase === "speaking") {
      stopSpeaking();
      return listen();
    }
    if (phase === "idle") return listen();
  }

  async function sendTyped(e: React.FormEvent) {
    e.preventDefault();
    const text = typed.trim();
    setTyped("");
    await ask(text);
  }

  async function ask(text: string) {
    if (!text || phase === "transcribing" || phase === "thinking" || phase === "connecting") return;
    if (!active) {
      activeRef.current = true;
      setActive(true);
    }
    if (listenerRef.current) {
      listenerRef.current.cancel();
      listenerRef.current = null;
      stopCaptions();
    }
    stopSpeaking();
    await runTurn({ text });
  }

  const seedNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!seed?.text || seedNonceRef.current === seed.nonce) return;
    seedNonceRef.current = seed.nonce;
    void ask(seed.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seed?.nonce]);

  const medicinePrompts = medicines.slice(0, 4).map((m) =>
    mode === "doctor"
      ? { label: `Explain ${m}`, text: `Help me explain ${m} to ${patientLabel}: what it's for, common side effects, and what to watch for.` }
      : { label: `${m} side effects?`, text: `What are the common side effects of my ${m}?` }
  );

  async function submitToTeam() {
    if (!token || !userTurns) return;
    setSending(true);
    setError(null);
    try {
      const clean = turnsRef.current.filter((t) => !t.pending).map(({ role, text }) => ({ role, text }));
      const res = await api.assistantSubmit(patientId, clean, recipient, token);
      end();
      setResult(`Sent to ${res.recipient_label}. They were notified: “${res.summary.insight}”`);
      onSubmitted?.(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the conversation");
    } finally {
      setSending(false);
    }
  }

  async function sendToPatient() {
    if (!token || !draft.trim()) return;
    setSending(true);
    setError(null);
    try {
      const res = await api.assistantSend(patientId, draft.trim(), includeVoice, token);
      end();
      setResult(
        `Sent to ${patientLabel}${res.voiced ? " with Ava's voice recording" : ""}. They were notified.`
      );
      setDraft("");
      setDraftEdited(false);
      onSent?.(res.room);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send the message");
    } finally {
      setSending(false);
    }
  }

  const busy = phase === "connecting" || phase === "transcribing" || phase === "thinking";
  const orbScale =
    phase === "listening" ? 1 + Math.max(...levels.slice(-4)) * 0.35 : phase === "speaking" ? 1.06 : 1;

  return (
    <div className="overflow-hidden rounded-[1.75rem] bg-gradient-to-br from-[#0b1220] via-[#10223a] to-[#0d5f59] text-white shadow-[0_24px_60px_rgba(11,18,32,0.35)]">
      <div className="grid gap-0 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        {/* Ava stage */}
        <div className="relative flex flex-col items-center gap-5 px-6 py-8 text-center">
          <div
            className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_50%_30%,rgba(45,212,191,0.22),transparent_60%)]"
            aria-hidden
          />
          <div className="relative flex h-44 w-44 items-center justify-center">
            {(phase === "speaking" || phase === "listening") && (
              <>
                <span className="absolute inset-0 animate-ping rounded-full bg-teal-300/15" />
                <span className="absolute inset-3 animate-pulse rounded-full bg-violet-300/10" />
              </>
            )}
            <div
              className={`relative flex h-32 w-32 items-center justify-center rounded-full bg-[conic-gradient(from_210deg,#5eead4,#a78bfa,#f9a8d4,#5eead4)] p-[3px] transition-transform duration-150 ${
                busy ? "animate-spin [animation-duration:3s]" : ""
              }`}
              style={{ transform: `scale(${orbScale})` }}
            >
              <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-[#0f1b2d]">
                <span className="font-display text-3xl font-extrabold tracking-tight">Ava</span>
                <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-teal-200/80">
                  {phase === "listening" ? "Listening" : phase === "speaking" ? "Speaking" : "Care AI"}
                </span>
              </div>
            </div>
          </div>

          <div className="relative">
            <p className="text-sm font-semibold text-teal-100">{PHASE_LABEL[phase]}</p>
            <p className="mt-1 text-xs text-slate-300">
              {mode === "doctor"
                ? `Tell Ava what ${patientLabel} should know. She drafts it in plain language.`
                : `Talk to Ava like a phone call. It goes to ${recipientLabel}.`}
            </p>
          </div>

          <div className="relative flex h-12 items-end gap-[3px]" aria-hidden>
            {levels.map((lv, i) => {
              const h =
                phase === "speaking"
                  ? 18 + Math.abs(Math.sin((i + 1) * 1.7)) * 26
                  : 4 + lv * 44;
              return (
                <span
                  key={i}
                  className={`w-[5px] rounded-full ${
                    phase === "speaking" ? "animate-pulse bg-violet-300" : "bg-teal-300"
                  } transition-[height] duration-100`}
                  style={{ height: `${h}px`, animationDelay: `${(i % 7) * 90}ms` }}
                />
              );
            })}
          </div>

          <div className="relative flex flex-wrap items-center justify-center gap-3">
            <button
              type="button"
              onClick={onMic}
              disabled={busy}
              className={`flex items-center gap-2.5 rounded-full px-6 py-3 text-sm font-bold shadow-lg transition hover:-translate-y-0.5 disabled:opacity-50 ${
                phase === "listening"
                  ? "bg-rose-500 text-white shadow-rose-500/30"
                  : "bg-white text-[#0b1220] shadow-teal-400/20"
              }`}
            >
              <svg width="14" height="18" viewBox="0 0 14 18" aria-hidden>
                <rect x="4" y="0" width="6" height="11" rx="3" fill="currentColor" />
                <path d="M1 8a6 6 0 0 0 12 0M7 14v4" stroke="currentColor" strokeWidth="1.8" fill="none" />
              </svg>
              {!active
                ? mode === "doctor"
                  ? "Start with Ava"
                  : "Start talking to Ava"
                : phase === "listening"
                  ? "Done speaking"
                  : phase === "speaking"
                    ? "Interrupt and talk"
                    : busy
                      ? "One moment…"
                      : "Tap to talk"}
            </button>
            {active && (
              <button
                type="button"
                onClick={end}
                className="rounded-full border border-white/25 px-4 py-3 text-sm font-semibold text-white/90 hover:bg-white/10"
              >
                End
              </button>
            )}
          </div>

          <label className="relative flex cursor-pointer items-center gap-2 text-xs text-slate-300">
            <input
              type="checkbox"
              checked={handsFree}
              onChange={(e) => setHandsFree(e.target.checked)}
              className="accent-teal-400"
            />
            Hands-free: Ava listens again after she speaks
          </label>

          {mode === "patient" && recipients.length > 0 && (
            <div className="relative w-full">
              <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200/80">Send to</p>
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                {[{ id: "team", label: "Full care team" } as AssistantRecipient, ...recipients].map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => setRecipient(r.id)}
                    className={`flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition ${
                      recipient === r.id
                        ? "bg-teal-300 text-[#0b1220]"
                        : "border border-white/20 text-white/85 hover:bg-white/10"
                    }`}
                  >
                    {r.id !== "team" && (
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${r.online ? "bg-emerald-400" : "bg-slate-400"}`}
                      />
                    )}
                    {r.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <p className="relative text-[11px] text-slate-400">
            Hears you with Meta Muse Voice · speaks with{" "}
            {voiceUsed === "elevenlabs" ? "ElevenLabs" : "your browser's voice (add an ElevenLabs key for Ava's voice)"}
          </p>
        </div>

        {/* Conversation */}
        <div className="flex min-h-[26rem] flex-col bg-white/[0.04] lg:border-l lg:border-white/10">
          {urgent && (
            <div className="bg-rose-500/90 px-5 py-3 text-sm font-semibold">
              This may be an emergency. If you have chest pain, trouble breathing or stroke signs, call 911 now.
            </div>
          )}
          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-5 py-5" style={{ maxHeight: "26rem" }}>
            {!turns.length && (
              <div className="flex h-full flex-col items-center justify-center gap-2 py-10 text-center text-sm text-slate-300">
                <p className="font-display text-lg font-bold text-white">
                  {mode === "doctor" ? `Draft an update for ${patientLabel}` : "Your doctor is busy? Talk to Ava."}
                </p>
                <p className="max-w-sm">
                  {mode === "doctor"
                    ? "Speak naturally, for example: “Tell them to lower lisinopril to 5 mg and check their blood pressure daily.”"
                    : "Tell her what's going on, ask about your medicines (she answers from the FDA label), or request an appointment. She'll send a summary to the doctors you choose."}
                </p>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={`flex ${t.role === "user" ? "justify-end" : "justify-start"}`}>
                <div
                  className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                    t.role === "user"
                      ? "rounded-br-md bg-white text-[#0b1220]"
                      : "rounded-bl-md bg-teal-400/15 text-teal-50 ring-1 ring-teal-300/20"
                  }`}
                >
                  <p className="text-[10px] font-bold uppercase tracking-[0.14em] opacity-60">
                    {t.role === "user" ? (mode === "doctor" ? "You" : patientLabel) : "Ava"}
                    {t.source === "muse_voice" && " · Muse Voice"}
                    {t.source === "browser_captions" && " · captions"}
                    {t.source === "typed" && " · typed"}
                  </p>
                  <p className={t.pending ? "italic opacity-70" : ""}>{t.text}</p>
                  {t.pending && <p className="mt-1 text-[11px] opacity-60">Transcribing with Muse Voice…</p>}
                  {!!t.fda?.length && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {t.fda.map((ref) => (
                        <a
                          key={ref.name}
                          href={ref.label_url || "https://open.fda.gov/apis/drug/label/"}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-teal-100 ring-1 ring-white/15 transition hover:bg-white/20"
                        >
                          <span className="rounded bg-sky-300 px-1 text-[9px] font-extrabold text-[#0b1220]">FDA</span>
                          Label · {ref.generic_name} ↗
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {phase === "listening" && (
              <div className="flex justify-end">
                <div className="max-w-[85%] rounded-2xl rounded-br-md border border-dashed border-white/30 px-4 py-2.5 text-sm italic text-white/80">
                  {caption || "Listening…"}
                </div>
              </div>
            )}
            {phase === "thinking" && (
              <div className="flex gap-1.5 px-2">
                {[0, 1, 2].map((d) => (
                  <span
                    key={d}
                    className="h-2 w-2 animate-bounce rounded-full bg-teal-200"
                    style={{ animationDelay: `${d * 150}ms` }}
                  />
                ))}
              </div>
            )}
          </div>

          {medicinePrompts.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto border-t border-white/10 px-4 pt-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <span className="shrink-0 text-[10px] font-bold uppercase tracking-[0.16em] text-sky-200/80">
                Ask · FDA label
              </span>
              {medicinePrompts.map((q) => (
                <button
                  key={q.label}
                  type="button"
                  disabled={busy}
                  onClick={() => void ask(q.text)}
                  className="shrink-0 rounded-full border border-sky-200/30 bg-sky-300/10 px-3 py-1 text-xs font-semibold text-sky-100 transition hover:bg-sky-300/20 disabled:opacity-40"
                >
                  {q.label}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={sendTyped}
            className={`flex gap-2 px-4 py-3 ${medicinePrompts.length ? "" : "border-t border-white/10"}`}
          >
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="Or type to Ava…"
              className="min-w-0 flex-1 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-sm text-white placeholder:text-slate-400 outline-none focus:border-teal-300"
            />
            <button
              type="submit"
              disabled={!typed.trim() || busy}
              className="rounded-xl bg-teal-300 px-4 py-2 text-sm font-bold text-[#0b1220] disabled:opacity-40"
            >
              Send
            </button>
          </form>

          {mode === "doctor" ? (
            <div className="space-y-3 border-t border-white/10 bg-white/[0.06] px-5 py-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-teal-200/80">
                  Message for {patientLabel}
                  {draftEdited ? " · edited by you" : draft ? " · drafted by Ava" : ""}
                </p>
                {draftEdited && (
                  <button
                    type="button"
                    onClick={() => setDraftEdited(false)}
                    className="text-xs font-semibold text-teal-200 underline-offset-2 hover:underline"
                  >
                    Let Ava keep updating it
                  </button>
                )}
              </div>
              <textarea
                value={draft}
                onChange={(e) => {
                  setDraft(e.target.value);
                  setDraftEdited(true);
                }}
                rows={4}
                placeholder="Ava's draft appears here as you talk. You can edit it before sending."
                className="w-full resize-y rounded-xl border border-white/15 bg-[#0b1220]/60 px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-slate-400 outline-none focus:border-teal-300"
              />
              <div className="flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={sendToPatient}
                  disabled={!draft.trim() || sending}
                  className={`rounded-xl px-5 py-2.5 text-sm font-bold text-[#0b1220] transition disabled:opacity-40 ${
                    ready ? "bg-teal-300 shadow-[0_0_24px_rgba(94,234,212,0.45)]" : "bg-white"
                  }`}
                >
                  {sending ? "Sending…" : `Send to ${patientLabel}`}
                </button>
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={includeVoice}
                    onChange={(e) => setIncludeVoice(e.target.checked)}
                    className="accent-teal-400"
                  />
                  Include Ava reading it aloud{tts === "elevenlabs" ? "" : " (needs ElevenLabs key)"}
                </label>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-white/10 bg-white/[0.06] px-5 py-4">
              <p className="text-xs text-slate-300">
                {userTurns
                  ? ready
                    ? "Ava has what she needs."
                    : "Keep talking, or send whenever you're ready."
                  : "Talk to Ava first, then send the summary."}
              </p>
              <button
                type="button"
                onClick={submitToTeam}
                disabled={!userTurns || sending}
                className={`rounded-xl px-5 py-2.5 text-sm font-bold text-[#0b1220] transition disabled:opacity-40 ${
                  ready ? "bg-teal-300 shadow-[0_0_24px_rgba(94,234,212,0.45)]" : "bg-white"
                }`}
              >
                {sending ? "Sending…" : `Send to ${recipientLabel}`}
              </button>
            </div>
          )}

          {(error || result) && (
            <div
              className={`px-5 py-3 text-sm ${
                error ? "bg-rose-500/20 text-rose-100" : "bg-emerald-400/15 text-emerald-100"
              }`}
            >
              {error || result}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
