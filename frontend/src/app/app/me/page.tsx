"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import type { PatientBundle, RoomMessage } from "@/lib/types";

export default function MePage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const chartId = user?.chart_id || "";
  const [bundle, setBundle] = useState<PatientBundle | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState("");
  const [toId, setToId] = useState(""); // "" = whole care team
  const [sending, setSending] = useState(false);
  const [sentNote, setSentNote] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
    if (ready && user?.kind === "doctor") router.replace("/app/patients");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token || !chartId) return;
    let cancelled = false;
    async function load(full = false) {
      try {
        const b = await api.openPatient(chartId, token!);
        if (cancelled) return;
        setBundle(b);
        setError(null);
        if (full || !summary) {
          const s = await api.summary(chartId, token!);
          if (!cancelled) setSummary(s.text);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not load your chart");
        }
      }
    }
    load(true);
    const t = setInterval(() => load(false), 8000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
    // summary intentionally omitted from deps so Muse text does not rewrite every poll
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, chartId]);

  const p = bundle?.patient;
  const meds = p?.prescriptions.filter((x) => x.status === "active") ?? [];
  const messages: RoomMessage[] = (bundle?.room?.messages || []).slice(-8).reverse();

  useAskScreen(
    p
      ? {
          patient_id: chartId,
          patient: p,
          briefing: bundle?.briefing,
          connections: bundle?.connections,
          snapshot: bundle?.snapshot,
          plain_summary: summary,
        }
      : {},
    !!p && user?.kind === "patient"
  );

  async function sendToDoctors(e: React.FormEvent) {
    e.preventDefault();
    if (!token || !chartId || !msg.trim()) return;
    setSending(true);
    setSentNote(null);
    try {
      const member = p?.team.find((m) => m.id === toId);
      const res = await api.postMessage(
        chartId,
        msg.trim(),
        token,
        toId ? { to_id: toId, to_label: member?.label } : undefined
      );
      setBundle((prev) =>
        prev
          ? {
              ...prev,
              room: res.room,
              briefing: res.briefing ?? prev.briefing,
            }
          : prev
      );
      setMsg("");
      setSentNote(
        member
          ? `Sent to ${member.label}. They will see it in your shared room.`
          : "Sent to your full care team. Doctors will see it in your shared room."
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not send message");
    } finally {
      setSending(false);
    }
  }

  if (!user || user.kind !== "patient") return null;

  return (
    <main className="landing relative w-full flex-1">
      <div className="landing-glow" aria-hidden />

      <div className="relative z-[1] site-wrap py-10 lg:py-14">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--brand)]">
          My care
        </p>
        <h1 className="font-display mt-3 text-[clamp(2.5rem,5vw,4.5rem)] font-extrabold leading-[0.92] tracking-tight text-[var(--ink)]">
          {user.label}
        </h1>
        <p className="mt-3 whitespace-nowrap text-[clamp(1rem,1.2vw,1.25rem)] leading-relaxed text-[var(--muted)]">
          Your doctors already share this information in one common space.
        </p>

        {error && (
          <p className="mt-8 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">
            {error}
          </p>
        )}

        {!p && !error && (
          <p className="mt-10 text-sm text-[var(--muted)]">Loading your chart…</p>
        )}

        {p && (
          <div className="mt-10 grid gap-5 lg:mt-12 lg:grid-cols-12 lg:gap-6">
            {summary && (
              <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-12">
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                  In plain words
                </p>
                <p className="mt-3 whitespace-pre-line text-[clamp(1rem,1.15vw,1.2rem)] leading-relaxed text-[var(--ink)]">
                  {summary}
                </p>
              </section>
            )}

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Conditions
              </p>
              <h2 className="font-display mt-2 text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                What you live with
              </h2>
              <ul className="mt-5 space-y-4">
                {p.conditions.map((c) => (
                  <li key={c.id} className="border-t border-[var(--line)] pt-4 first:border-0 first:pt-0">
                    <p className="font-display text-base font-bold text-[var(--ink)]">{c.name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{c.note}</p>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Medicines
              </p>
              <h2 className="font-display mt-2 text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                What you take
              </h2>
              <ul className="mt-5 space-y-4">
                {meds.map((rx) => (
                  <li key={rx.id} className="border-t border-[var(--line)] pt-4 first:border-0 first:pt-0">
                    <p className="font-display text-base font-bold text-[var(--ink)]">
                      {rx.name}
                    </p>
                    <p className="mt-1 text-sm text-[var(--muted)]">
                      {rx.dose}
                      {rx.reason ? ` · ${rx.reason}` : ""}
                    </p>
                  </li>
                ))}
                {!meds.length && (
                  <li className="text-sm text-[var(--muted)]">No active medicines listed.</li>
                )}
              </ul>
            </section>

            <section className="rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-4">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Care team
              </p>
              <h2 className="font-display mt-2 text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Who follows you
              </h2>
              <ul className="mt-5 space-y-3">
                {p.team.map((m, i) => {
                  const hues = ["#0F766E", "#1D4ED8", "#B45309", "#7C3AED"];
                  const color = hues[i % hues.length];
                  return (
                    <li
                      key={m.id}
                      className="flex items-center gap-3 rounded-2xl bg-[var(--paper)] px-3 py-3"
                    >
                      <span
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                        style={{ background: color }}
                      >
                        {m.label.replace("Doctor ", "").slice(0, 1)}
                      </span>
                      <span className="min-w-0">
                        <span className="font-display block font-bold text-[var(--ink)]">
                          {m.label}
                        </span>
                        <span className="block text-sm text-[var(--muted)]">
                          {m.specialty || m.role}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>

            <section
              id="message-team"
              className="scroll-mt-24 rounded-[1.75rem] border border-[var(--line)] bg-white p-[clamp(1.25rem,2vw,2rem)] shadow-[0_16px_40px_rgba(15,23,42,0.05)] lg:col-span-12"
            >
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[var(--brand)]">
                Reach your doctors
              </p>
              <h2 className="font-display mt-2 text-[clamp(1.35rem,1.8vw,1.85rem)] font-bold tracking-tight">
                Message the care team
              </h2>
              <p className="mt-2 max-w-2xl text-sm text-[var(--muted)]">
                Send to the whole care team, or to one doctor on your chart.
              </p>

              <form onSubmit={sendToDoctors} className="mt-6 space-y-3">
                <label className="block">
                  <span className="text-sm font-semibold text-[var(--ink)]">Send to</span>
                  <select
                    value={toId}
                    onChange={(e) => setToId(e.target.value)}
                    className="mt-1.5 w-full rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] focus:bg-white sm:max-w-md"
                  >
                    <option value="">Full care team</option>
                    {p.team.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label}
                        {m.specialty ? ` · ${m.specialty}` : ""}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
                  <label className="min-w-0 flex-1">
                    <span className="sr-only">Message</span>
                    <textarea
                      value={msg}
                      onChange={(e) => setMsg(e.target.value)}
                      rows={3}
                      placeholder="Ask a question or share an update…"
                      className="w-full resize-y rounded-2xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-sm outline-none transition focus:border-[var(--brand)] focus:bg-white"
                    />
                  </label>
                  <button
                    type="submit"
                    disabled={sending || !msg.trim()}
                    className="shrink-0 rounded-2xl bg-[var(--brand)] px-6 py-3 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)] disabled:opacity-40"
                  >
                    {sending ? "Sending…" : "Send"}
                  </button>
                </div>
              </form>

              {sentNote && (
                <p className="mt-3 text-sm font-medium text-teal-800">{sentNote}</p>
              )}

              {messages.length > 0 && (
                <ul className="mt-6 space-y-3 border-t border-[var(--line)] pt-5">
                  {messages.map((m) => (
                    <li key={m.id} className="rounded-2xl bg-[var(--paper)] px-4 py-3">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <p className="text-sm font-semibold text-[var(--ink)]">
                          {m.author_label}
                          <span className="ml-2 font-normal text-[var(--muted)]">
                            → {m.to_label || "Care team"}
                          </span>
                        </p>
                        <p className="text-xs text-[var(--muted)]">
                          {new Date(m.timestamp).toLocaleString()}
                        </p>
                      </div>
                      <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">{m.text}</p>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
