"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskPageScreen } from "@/lib/askScreen";

const SUGGESTIONS = [
  "What's going on across care?",
  "Which patients need attention?",
  "Summarize active medicines",
  "What should happen next?",
];

const PATIENT_SUGGESTIONS = [
  "What should I know right now?",
  "Explain my medicines simply",
  "Any alerts I should watch?",
  "What did my doctors say?",
];

function routeLabel(pathname: string): string {
  if (pathname.startsWith("/app/patients/") && pathname !== "/app/patients")
    return "Patient room";
  if (pathname.startsWith("/app/patients")) return "Patients";
  if (pathname.startsWith("/app/insights") || pathname.startsWith("/app/updates"))
    return "Insights";
  if (pathname.startsWith("/app/me")) return "My care";
  if (pathname.startsWith("/login")) return "Sign in";
  if (pathname === "/") return "Home";
  return pathname;
}

function inline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-[var(--ink)]">
        {part.slice(2, -2)}
      </strong>
    ) : (
      part.replace(/\*/g, "")
    )
  );
}

function AnswerBody({ text }: { text: string }) {
  const lines = text
    .split("\n")
    .map((l) => l.replace(/^#+\s*/, "").trim())
    .filter(Boolean);
  const bullets = lines.filter((l) => /^[-•*]\s+/.test(l));
  const next = lines.find((l) => /^next:/i.test(l));
  const prose = lines.filter((l) => !bullets.includes(l) && l !== next);

  return (
    <div className="space-y-2">
      {prose.map((l, i) => (
        <p key={i} className={i === 0 ? "font-medium text-[var(--ink)]" : ""}>
          {inline(l)}
        </p>
      ))}
      {bullets.length > 0 && (
        <ul className="space-y-1">
          {bullets.map((l, i) => (
            <li key={i} className="flex gap-2">
              <span className="mt-[0.55rem] h-1 w-1 shrink-0 rounded-full bg-teal-700" />
              <span>{inline(l.replace(/^[-•*]\s+/, ""))}</span>
            </li>
          ))}
        </ul>
      )}
      {next && (
        <p className="border-t border-[var(--line)] pt-2 text-xs">
          <span className="font-semibold uppercase tracking-wide text-teal-800">Next</span>{" "}
          {inline(next.replace(/^next:\s*/i, ""))}
        </p>
      )}
    </div>
  );
}

function patientIdFromPath(pathname: string): string | undefined {
  const m = pathname.match(/^\/app\/patients\/([^/]+)/);
  return m?.[1];
}

/** Platform-wide Ask — available on every signed-in view. */
export function GlobalAsk() {
  const { token, user } = useAuth();
  const pathname = usePathname();
  const pageScreen = useAskPageScreen();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [inputFade, setInputFade] = useState(false);
  const [history, setHistory] = useState<
    { q: string; a: string; source?: string }[]
  >([]);
  const [live, setLive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tab = routeLabel(pathname);
  const patientId =
    patientIdFromPath(pathname) ||
    (typeof pageScreen.patient_id === "string" ? pageScreen.patient_id : undefined);
  const prompts =
    user?.kind === "patient" ? PATIENT_SUGGESTIONS : SUGGESTIONS;

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
      inputRef.current?.focus();
    }
  }, [history, busy, open]);

  useEffect(() => {
    setHistory([]);
    setOpen(false);
    setQ("");
    setInputFade(false);
  }, [pathname]);

  useEffect(() => {
    return () => {
      if (fadeTimer.current) clearTimeout(fadeTimer.current);
    };
  }, []);

  if (!token || !user) return null;

  const viewerLabel = user.label;
  const authToken = token;

  function fadeOutQuestion(displayText: string) {
    if (fadeTimer.current) clearTimeout(fadeTimer.current);
    setQ(displayText);
    setInputFade(false);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => setInputFade(true));
    });
    fadeTimer.current = setTimeout(() => {
      setQ("");
      setInputFade(false);
    }, 340);
  }

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text || busy) return;
    setBusy(true);
    fadeOutQuestion(text);
    try {
      const visible =
        typeof document !== "undefined"
          ? (document.querySelector("main")?.innerText || "").slice(0, 6000)
          : "";

      const res = await api.ask(
        {
          question: text,
          patient_id: patientId,
          tab,
          screen: {
            ...pageScreen,
            route: pathname,
            tab,
            viewer: viewerLabel,
            visible_page_text: visible,
          },
        },
        authToken
      );
      setLive(!!res.gemini_enabled);
      setHistory((h) => [
        ...h.slice(-5),
        { q: text, a: res.answer, source: res.source },
      ]);
    } catch (e) {
      setHistory((h) => [
        ...h.slice(-5),
        {
          q: text,
          a: e instanceof Error ? e.message : "Could not answer",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`fixed bottom-5 right-5 z-50 flex h-12 items-center gap-2 rounded-full px-5 text-sm font-bold text-white shadow-[0_12px_40px_rgba(15,23,42,0.28)] transition hover:scale-[1.02] sm:bottom-6 sm:right-6 ${
          open ? "bg-[var(--brand-deep)]" : "bg-[var(--ink)]"
        }`}
        aria-label="Ask ClearPath"
        aria-expanded={open}
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs">
          ?
        </span>
        Ask
      </button>

      {open && (
        <div
          className="fixed inset-x-3 bottom-[4.75rem] z-50 flex max-h-[min(72vh,34rem)] w-auto flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.16)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[min(100vw-2rem,420px)]"
          role="dialog"
          aria-label="Ask ClearPath"
        >
          <div className="flex items-start justify-between gap-3 border-b border-[var(--line)] bg-gradient-to-b from-slate-50 to-white px-4 py-3.5">
            <div className="min-w-0">
              <p className="font-display text-base font-bold tracking-tight">Ask</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {live && (
                <span className="rounded-md bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-teal-900">
                  Live
                </span>
              )}
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:bg-slate-100"
              >
                Close
              </button>
            </div>
          </div>

          <div className="max-h-80 flex-1 space-y-3 overflow-y-auto px-4 py-3">
            {history.map((h, i) => (
              <div key={`${h.q}-${i}`} className="space-y-1.5 text-sm">
                <p className="rounded-xl bg-[var(--ink)] px-3 py-2 text-white">{h.q}</p>
                <div className="rounded-xl border border-[var(--line)] bg-slate-50/80 px-3 py-2.5 leading-relaxed text-slate-700">
                  <AnswerBody text={h.a} />
                </div>
              </div>
            ))}
            {busy && (
              <p className="animate-pulse text-xs text-[var(--muted)]">
                Give me one second, I am getting you the right information…
              </p>
            )}
            {!busy && (
              <div>
                {!history.length && (
                  <p className="mb-2 text-xs text-[var(--muted)]">
                    Try a question to get started.
                  </p>
                )}
                {!!history.length && (
                  <p className="mb-2 text-xs text-[var(--muted)]">Ask another</p>
                )}
                <div className="flex flex-wrap gap-1.5">
                  {prompts.map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => ask(s)}
                      className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1.5 text-left text-xs font-medium text-slate-700 transition hover:border-teal-700/35 hover:bg-teal-50/50"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 border-t border-[var(--line)] bg-white p-3">
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => {
                if (inputFade) return;
                setQ(e.target.value);
              }}
              onKeyDown={(e) => e.key === "Enter" && !busy && ask()}
              placeholder="Type a question…"
              disabled={busy}
              className={`flex-1 rounded-xl border border-[var(--line)] px-3 py-2.5 text-sm outline-none transition-opacity duration-300 focus:border-teal-700 disabled:cursor-default ${
                inputFade ? "opacity-0" : "opacity-100"
              }`}
            />
            <button
              type="button"
              disabled={busy || (!q.trim() && !inputFade)}
              onClick={() => ask()}
              className="rounded-xl bg-[var(--brand)] px-4 py-2.5 text-sm font-bold text-white disabled:opacity-40"
            >
              Go
            </button>
          </div>
        </div>
      )}
    </>
  );
}
