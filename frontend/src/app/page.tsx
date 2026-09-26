"use client";

import Link from "next/link";

export default function HomePage() {
  return (
    <main className="landing relative flex w-full flex-1 flex-col">
      <div className="landing-glow" aria-hidden />

      <section className="relative z-[1] flex w-full flex-1 flex-col lg:min-h-[calc(100dvh-4.25rem)] lg:flex-row">
        {/* Brand + CTA — fills left half on desktop, full width on mobile */}
        <div className="flex w-full flex-1 flex-col justify-between px-[var(--pad)] py-10 sm:py-14 lg:w-[58%] lg:px-16 lg:py-16 xl:px-20 2xl:px-24">
          <div className="animate-[fadeRise_0.7s_ease-out]">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-[var(--brand)] sm:text-sm">
              Bringing care teams closer
            </p>
            <h1 className="font-display mt-3 text-[clamp(3.5rem,10vw,7.5rem)] font-extrabold leading-[0.9] tracking-tight text-[var(--ink)] sm:mt-4">
              ClearPath
            </h1>
            <p className="mt-6 max-w-[36rem] text-[clamp(1.1rem,1.8vw,1.45rem)] leading-relaxed text-[var(--muted)] xl:max-w-[40rem]">
              Doctor A, B, C, and D meet Patient 1 in one living room. Shared chart.
              Live huddle. Visit notes the whole team sees — so people stop repeating
              themselves.
            </p>
            <div className="mt-10 flex flex-wrap items-center gap-3 sm:mt-12 sm:gap-4">
              <Link
                href="/login"
                className="rounded-2xl bg-[var(--brand)] px-8 py-4 text-base font-bold text-white shadow-[0_14px_34px_rgba(15,118,110,0.28)] transition hover:bg-[var(--brand-deep)] hover:shadow-[0_18px_40px_rgba(15,118,110,0.34)] sm:px-10 sm:text-lg"
              >
                Enter care space
              </Link>
              <Link
                href="/login"
                className="rounded-2xl border border-[var(--line)] bg-white/80 px-6 py-4 text-base font-semibold text-[var(--ink)] backdrop-blur transition hover:border-teal-700/30 hover:bg-white sm:px-8 sm:text-lg"
              >
                Sign in
              </Link>
            </div>
          </div>

          <ul className="mt-14 grid w-full gap-8 border-t border-[var(--line)] pt-10 animate-[fadeRise_0.9s_ease-out] sm:grid-cols-3 sm:gap-8 lg:mt-16 lg:gap-10 lg:pt-12">
            {[
              ["Shared chart", "Conditions, medicines, and treatments — one source of truth."],
              ["Live team room", "Doctors talk; a clear briefing names the next human step."],
              ["Visit capture", "What was said in clinic lands on the chart for everyone."],
            ].map(([t, d]) => (
              <li key={t} className="min-w-0">
                <p className="font-display text-base font-bold sm:text-lg lg:text-xl">{t}</p>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)] lg:text-[0.95rem]">
                  {d}
                </p>
              </li>
            ))}
          </ul>
        </div>

        {/* Full-bleed care-space plane — fills remaining desktop width */}
        <aside
          className="relative hidden min-h-[22rem] w-full overflow-hidden bg-[var(--sidebar)] text-white lg:flex lg:w-[42%] lg:min-h-0 lg:self-stretch"
          aria-hidden
        >
          <div className="landing-panel-glow" />
          <div className="relative z-[1] flex h-full w-full flex-col justify-between p-10 xl:p-14">
            <div className="animate-[fadeRise_0.85s_ease-out]">
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/90">
                Live care space
              </p>
              <p className="font-display mt-5 text-[clamp(2rem,3.2vw,3.25rem)] font-bold leading-[1.05] tracking-tight">
                One room.
                <br />
                Four doctors.
                <br />
                Shared truth.
              </p>
            </div>

            <ul className="mt-12 space-y-5 animate-[fadeRise_1s_ease-out]">
              {[
                ["Doctor A", "Primary"],
                ["Doctor B", "Cardiology"],
                ["Doctor C", "Pharmacy"],
                ["Doctor D", "Care coordination"],
              ].map(([name, role]) => (
                <li key={name} className="flex items-baseline justify-between gap-4 border-b border-white/10 pb-4">
                  <span className="font-display text-lg font-semibold tracking-tight">{name}</span>
                  <span className="text-sm text-[var(--sidebar-muted)]">{role}</span>
                </li>
              ))}
            </ul>

            <p className="mt-10 max-w-sm text-sm leading-relaxed text-[var(--sidebar-muted)]">
              Patient 1&apos;s chart stays open for the whole team — conditions,
              medicines, and the next human step.
            </p>
          </div>
        </aside>
      </section>
    </main>
  );
}
