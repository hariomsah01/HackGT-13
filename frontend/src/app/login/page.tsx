"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { PublicUser } from "@/lib/types";

export default function LoginPage() {
  const [users, setUsers] = useState<PublicUser[]>([]);
  const [selected, setSelected] = useState("doctor_a");
  const [pin, setPin] = useState("1111");
  const [error, setError] = useState<string | null>(null);
  const { login, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    api.users().then((list) => {
      setUsers(list);
      if (list[0]) {
        setSelected(list[0].id);
        setPin(list[0].pin_hint);
      }
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    router.replace(user.kind === "patient" ? "/app/me" : "/app/patients");
  }, [user, router]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const res = await api.login(selected, pin);
      login(res.token, res.user);
      router.push(res.user.kind === "patient" ? "/app/me" : "/app/patients");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign in");
    }
  }

  return (
    <main className="shell mx-auto flex min-h-[calc(100vh-4.5rem)] min-h-[calc(100dvh-4.5rem)] flex-col justify-center py-10">
      <h1 className="font-display text-3xl font-bold">Sign in</h1>
      <p className="mt-2 text-sm text-[var(--muted)]">
        Choose who you are. Doctors share the patient room together.
      </p>
      <form onSubmit={onSubmit} className="mt-8 space-y-3">
        {users.map((u) => (
          <button
            key={u.id}
            type="button"
            onClick={() => {
              setSelected(u.id);
              setPin(u.pin_hint);
            }}
            className={`flex w-full items-center gap-3 rounded-2xl border-2 px-4 py-3 text-left ${
              selected === u.id
                ? "border-[var(--brand)] bg-teal-50"
                : "border-[var(--line)] bg-white"
            }`}
          >
            <span
              className="flex h-10 w-10 items-center justify-center rounded-xl text-xs font-bold text-white"
              style={{ background: u.color }}
            >
              {u.label.replace("Doctor ", "").replace("Patient", "P")}
            </span>
            <span>
              <span className="block font-semibold">{u.label}</span>
              <span className="text-xs text-[var(--muted)]">
                {u.specialty || u.role} · PIN {u.pin_hint}
              </span>
            </span>
          </button>
        ))}
        <label className="block pt-2 text-sm font-semibold">
          PIN
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value)}
            className="mt-1 w-full rounded-xl border border-[var(--line)] px-3 py-2"
          />
        </label>
        {error && (
          <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-800">{error}</p>
        )}
        <button
          type="submit"
          className="w-full rounded-2xl bg-[var(--brand)] py-3 text-sm font-bold text-white"
        >
          Enter
        </button>
      </form>
    </main>
  );
}
