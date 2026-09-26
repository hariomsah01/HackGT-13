"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { useAskScreen } from "@/lib/askScreen";
import type { ActivityEvent } from "@/lib/types";

export default function UpdatesPage() {
  const { token, user, ready } = useAuth();
  const router = useRouter();
  const [events, setEvents] = useState<ActivityEvent[]>([]);

  useAskScreen({ activity: events.slice(0, 30) }, events.length > 0);

  useEffect(() => {
    if (ready && !user) router.replace("/login");
  }, [ready, user, router]);

  useEffect(() => {
    if (!token) return;
    const load = () => api.activity(token).then(setEvents).catch(() => {});
    load();
    const t = setInterval(load, 4000);
    return () => clearInterval(t);
  }, [token]);

  return (
    <main className="workspace w-full">
      <h1 className="font-display text-3xl font-bold tracking-tight xl:text-4xl">Updates</h1>
      <p className="mt-1 text-[var(--muted)]">
        Real-time activity across the shared care space
      </p>

      <div className="mt-8 grid gap-3 md:grid-cols-2 xl:grid-cols-3">
        {events.map((e) => (
          <article key={e.id} className="card px-5 py-4">
            <p className="text-xs font-medium text-[var(--muted)]">
              {new Date(e.timestamp).toLocaleString()}
            </p>
            <p className="mt-2 text-sm leading-relaxed">
              <strong>{e.actor_label}</strong> · {e.detail}
            </p>
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
