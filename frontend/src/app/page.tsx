"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="flex w-full flex-1 flex-col px-[var(--pad)] py-10 sm:py-14 lg:px-12 lg:py-16">
      <section className="flex w-full flex-1 flex-col justify-between gap-12">
        <div className="max-w-4xl">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand)] sm:text-sm">
            Bringing care teams closer
          </p>
          <h1 className="font-display mt-4 text-[clamp(3rem,9vw,6.5rem)] font-extrabold leading-[0.92] tracking-tight">
            ClearPath
          </h1>
          <p className="mt-6 max-w-2xl text-[clamp(1.1rem,2.4vw,1.45rem)] leading-relaxed text-[var(--muted)]">
            Doctor A, B, C, and D meet Patient 1 in one living room. Shared chart. Live huddle.
            Visit notes the whole team sees — so people stop repeating themselves.
          </p>
          <div className="mt-10 flex flex-wrap items-center gap-3">
            <Link
              href="/login"
              className="rounded-2xl bg-[var(--brand)] px-8 py-4 text-base font-bold text-white shadow-[0_14px_34px_rgba(15,118,110,0.28)] transition hover:bg-[var(--brand-deep)] sm:text-lg"
            >
              Enter care space
            </Link>
            <Link
              href="/login"
              className="rounded-2xl border border-[var(--line)] bg-white/80 px-6 py-4 text-base font-semibold text-[var(--ink)] backdrop-blur"
            >
              Sign in
            </Link>
          </div>
        </div>

        <ul className="grid w-full gap-8 border-t border-[var(--line)] pt-10 sm:grid-cols-3 sm:gap-12">
          {[
            ["Shared chart", "Conditions, medicines, and treatments — one source of truth."],
            ["Live team room", "Doctors talk; a clear briefing names the next human step."],
            ["Visit capture", "What was said in clinic lands on the chart for everyone."],
          ].map(([t, d]) => (
            <li key={t}>
              <p className="font-display text-lg font-bold sm:text-xl">{t}</p>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)] sm:text-base">
                {d}
              </p>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
