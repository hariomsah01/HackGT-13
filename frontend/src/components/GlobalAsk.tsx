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

function routeLabel(pathname: string): string {
  if (pathname.startsWith("/app/patients/") && pathname !== "/app/patients")
    return "Patient room";
  if (pathname.startsWith("/app/patients")) return "Patients";
  if (pathname.startsWith("/app/insights")) return "Insights";
  if (pathname.startsWith("/app/updates")) return "Updates";
  if (pathname.startsWith("/app/me")) return "My care";
  if (pathname.startsWith("/login")) return "Sign in";
  if (pathname === "/") return "Home";
  return pathname;
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
  const [history, setHistory] = useState<{ q: string; a: string }[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);

  const tab = routeLabel(pathname);
  const patientId =
    patientIdFromPath(pathname) ||
    (typeof pageScreen.patient_id === "string" ? pageScreen.patient_id : undefined);

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, busy, open]);

  // Reset thread when navigating so answers stay in context of the new place
  useEffect(() => {
    setHistory([]);
    setOpen(false);
  }, [pathname]);

  if (!token || !user) return null;

  const viewerLabel = user.label;
  const authToken = token;

  async function ask(question?: string) {
    const text = (question ?? q).trim();
    if (!text) return;
    setBusy(true);
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
      setHistory((h) => [...h.slice(-5), { q: text, a: res.answer }]);
      setQ("");
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
        className="fixed bottom-5 right-5 z-50 flex h-12 items-center gap-2 rounded-full bg-[var(--ink)] px-5 text-sm font-bold text-white shadow-[0_12px_40px_rgba(15,23,42,0.35)] transition hover:scale-[1.02] sm:bottom-6 sm:right-6"
        aria-label="Ask"
      >
        <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/15 text-xs">
          ?
        </span>
        Ask
      </button>

      {open && (
        <div className="fixed inset-x-3 bottom-[4.75rem] z-50 flex max-h-[min(70vh,32rem)] w-auto flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-white shadow-[0_24px_60px_rgba(15,23,42,0.18)] sm:inset-x-auto sm:bottom-24 sm:right-6 sm:w-[min(100vw-2rem,400px)]">
          <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
            <div>
              <p className="font-display text-base font-bold">Ask</p>
              <p className="text-[11px] text-[var(--muted)]">
                Whole care space · {tab}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-full px-2 py-1 text-sm text-[var(--muted)] hover:bg-slate-50"
            >
              Close
            </button>
          </div>

          <div className="max-h-72 space-y-3 overflow-y-auto px-4 py-3">
            {!history.length && !busy && (
              <div className="flex flex-wrap gap-1.5">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => ask(s)}
                    className="rounded-full border border-[var(--line)] bg-slate-50 px-2.5 py-1 text-xs font-medium text-slate-700 hover:border-teal-700/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            )}
            {history.map((h, i) => (
              <div key={`${h.q}-${i}`} className="space-y-1.5 text-sm">
                <p className="rounded-xl bg-slate-900 px-3 py-2 text-white">{h.q}</p>
                <p className="rounded-xl bg-slate-50 px-3 py-2 leading-relaxed text-slate-700">
                  {h.a}
                </p>
              </div>
            ))}
            {busy && (
              <p className="animate-pulse text-xs text-[var(--muted)]">
                Looking across ClearPath…
              </p>
            )}
            <div ref={bottomRef} />
          </div>

          <div className="flex gap-2 border-t border-[var(--line)] p-3">
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && !busy && ask()}
              placeholder="Ask about anyone or anything here…"
              className="flex-1 rounded-xl border border-[var(--line)] px-3 py-2 text-sm outline-none focus:border-teal-700"
            />
            <button
              type="button"
              disabled={busy || !q.trim()}
              onClick={() => ask()}
              className="rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white disabled:opacity-40"
            >
              Go
            </button>
          </div>
        </div>
      )}
    </>
  );
}
