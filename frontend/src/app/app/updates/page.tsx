"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import type { ActivityEvent, HandoffPack } from "@/lib/types";

export default function UpdatesPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [handoffs, setHandoffs] = useState<HandoffPack[]>([]);

  useAskScreen(
    {
      activity: events.slice(0, 30),
      handoffs: handoffs.slice(0, 10),
    },
    events.length > 0 || handoffs.length > 0
  );

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token) return;
    const load = () => {
      api.activity(token).then(setEvents).catch(() => {});
      api
        .handoffs(token)
        .then((r) => setHandoffs(r.handoffs || []))
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [token]);

  const rxEvents = events.filter((e) =>
    ["rx_analyze", "rx_add"].includes(e.kind)
  );

  return (
    <main className="workspace w-full">
      <h1 className="font-display text-3xl font-bold tracking-tight xl:text-4xl">Updates</h1>
      <p className="mt-1 text-[var(--muted)]">
        Real-time activity across the shared care space
      </p>

      {!!handoffs.length && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">Open handoffs</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Questions and attention flags the team still needs to close
          </p>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {handoffs.map((h) => (
              <Link
                key={h.patient_id}
                href={`/app/patients/${h.patient_id}`}
                className="card block px-5 py-4 transition hover:border-teal-600/40"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="font-display text-base font-bold">{h.patient_label}</p>
                  <span
                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      h.attention?.level === "caution"
                        ? "bg-rose-50 text-rose-900"
                        : h.attention?.level === "review"
                          ? "bg-amber-50 text-amber-950"
                          : "bg-sky-50 text-sky-950"
                    }`}
                  >
                    {h.attention?.badge || "Handoff"}
                  </span>
                </div>
                {h.open_question && (
                  <p className="mt-2 text-sm">
                    <span className="text-xs text-[var(--muted)]">Open · </span>
                    {h.open_question}
                  </p>
                )}
                {h.owner && (
                  <p className="mt-1 text-xs text-[var(--muted)]">Owner: {h.owner}</p>
                )}
                {h.next_step && (
                  <p className="mt-2 text-xs font-medium text-teal-900">Next: {h.next_step}</p>
                )}
              </Link>
            ))}
          </div>
        </section>
      )}

      {!!rxEvents.length && (
        <section className="mt-8">
          <h2 className="font-display text-lg font-bold">Prescription activity</h2>
          <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {rxEvents.slice(0, 6).map((e) => (
              <article key={e.id} className="card border-amber-200/80 bg-amber-50/40 px-5 py-4">
                <p className="text-xs font-medium text-[var(--muted)]">
                  {new Date(e.timestamp).toLocaleString()}
                </p>
                <p className="mt-2 text-sm leading-relaxed">
                  <strong>{e.actor_label}</strong> · {e.detail}
                </p>
              </article>
            ))}
          </div>
        </section>
      )}

      <h2 className="font-display mt-10 text-lg font-bold">All activity</h2>
      <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((e) => (
          <article key={e.id} className="card px-5 py-4">
            <p className="text-xs font-medium text-[var(--muted)]">
              {new Date(e.timestamp).toLocaleString()}
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              <strong>{e.actor_label}</strong> · {e.detail}
            </p>
            {e.kind.startsWith("rx_") && (
              <p className="mt-2 text-[10px] font-bold uppercase tracking-wide text-amber-800">
                Shared Rx
              </p>
            )}
          </article>
        ))}
        {!events.length && (
          <p className="card col-span-full p-10 text-center text-[var(--muted)]">
            Quiet for now — open a patient room to begin.
          </p>
        )}
      </div>
    </main>
  );
}
