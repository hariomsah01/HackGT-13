"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const ROOM = [
  { who: "Doctor A", role: "Primary care", time: "9:02", did: "Raised the lisinopril dose" },
  { who: "Doctor B", role: "Cardiology", time: "9:40", did: "Asked for a fresh ECG" },
  { who: "Doctor C", role: "Pharmacy", time: "10:15", did: "Caught an NSAID and kidney risk" },
  { who: "Doctor D", role: "Nephrology", time: "11:05", did: "Confirmed labs before any change" },
] as const;

const PROBLEMS = [
  [
    "The MRI waits 18 days",
    "Doctor B orders a stress MRI. Staff still fax prior history by hand. By the time it clears, the chest pain has gotten worse.",
  ],
  [
    "Two charts, two drug lists",
    "Cardiology adds a blood thinner. Nephrology never sees it. The patient fills both scripts at different pharmacies.",
  ],
  [
    "Surgery stuck on paperwork",
    "The knee replacement is medically ready. The insurer asks for therapy notes that live in another clinic's system.",
  ],
] as const;

const FEATURES = [
  [
    "Shared room presence",
    "Open Patient 1 and see which doctors are in the chart now, plus the last note each one left.",
  ],
  [
    "Visit audio to note",
    "Record the visit. Muse turns speech into a structured note the rest of the team can read the same day.",
  ],
  [
    "Rx safety before save",
    "Type a new medicine and run Analyze. OpenAI checks it against active scripts from every doctor on the chart.",
  ],
  [
    "Team briefing card",
    "At the top of the room: open question, owner and next step. Muse refreshes it when the huddle changes.",
  ],
  [
    "Ask across the chart",
    "Ask which patients need attention or what Patient 1 is on. Gemini answers from live ClearPath data.",
  ],
  [
    "Patient-facing summary",
    "Patients open My care and read conditions and medicines in plain language, without clinic jargon.",
  ],
] as const;

const PA_REQUESTS = [
  {
    type: "Medicine",
    fields: [
      ["Diagnosis", "Chronic kidney disease, stage 3"],
      ["Requested", "Empagliflozin 10 mg daily"],
      ["Tried before", "Metformin, lisinopril"],
      ["Ordered by", "Doctor D, Nephrology"],
    ],
  },
  {
    type: "Test",
    fields: [
      ["Diagnosis", "Chest pain on exertion"],
      ["Requested", "Cardiac stress MRI"],
      ["Supporting", "Abnormal ECG from last visit"],
      ["Ordered by", "Doctor B, Cardiology"],
    ],
  },
  {
    type: "Surgery",
    fields: [
      ["Diagnosis", "Severe knee osteoarthritis"],
      ["Requested", "Total knee replacement"],
      ["Tried before", "Physical therapy, injections"],
      ["Ordered by", "Doctor A, Primary care"],
    ],
  },
  {
    type: "Procedure",
    fields: [
      ["Diagnosis", "Suspected colon bleeding"],
      ["Requested", "Colonoscopy"],
      ["Supporting", "Low hemoglobin on recent labs"],
      ["Ordered by", "Doctor C, Gastroenterology"],
    ],
  },
] as const;

const PA_STEPS = 4;

const AUDIENCE = [
  ["For doctors", "Walk into every visit already knowing what the rest of the team did."],
  ["For patients", "Stop carrying folders between clinics. Your team already has the picture."],
  ["For pharmacists", "Spot conflicts across prescribers before a single pill is dispensed."],
] as const;

const ENGINES = [
  ["Meta Muse", "Transcribes visits and writes the team briefing."],
  ["Google Gemini", "Answers questions about anything on the platform."],
  ["OpenAI", "Reviews each new prescription for safety."],
] as const;

export default function HomePage() {
  const [active, setActive] = useState(0);
  const [pa, setPa] = useState({ req: 0, filled: 0 });

  useEffect(() => {
    const id = window.setInterval(() => setActive((i) => (i + 1) % ROOM.length), 2600);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      setPa((s) =>
        s.filled < PA_STEPS + 2
          ? { ...s, filled: s.filled + 1 }
          : { req: (s.req + 1) % PA_REQUESTS.length, filled: 0 }
      );
    }, 850);
    return () => window.clearInterval(id);
  }, []);

  const { req, filled } = pa;
  const paReady = filled >= PA_STEPS;
  const paRequest = PA_REQUESTS[req];

  function pickRequest(i: number) {
    setPa({ req: i, filled: 0 });
  }

  return (
    <main className="landing relative w-full flex-1">
      <div className="landing-glow" aria-hidden />

      {/* Hero */}
      <section className="relative z-[1] flex min-h-[calc(100dvh-4.25rem)] w-full items-center">
        <div className="site-wrap grid w-full items-center gap-12 py-14 lg:grid-cols-[1.15fr_1fr] lg:gap-[5vw] lg:py-16">
          <div className="animate-[fadeRise_0.6s_ease-out]">
            <p className="inline-flex items-center gap-2 rounded-full border border-teal-700/20 bg-white/70 px-4 py-1.5 text-sm font-semibold text-[var(--brand)]">
              <span className="h-2 w-2 animate-pulse rounded-full bg-teal-500" />
              Built for patients with more than one doctor
            </p>
            <h1 className="font-display mt-6 text-[clamp(3.75rem,9vw,12rem)] font-extrabold leading-[0.88] tracking-tight text-[var(--ink)]">
              ClearPath
            </h1>
            <p className="mt-6 max-w-[24ch] text-[clamp(1.6rem,2.6vw,3.5rem)] font-semibold leading-[1.1] tracking-tight text-[var(--ink)]">
              Bringing care teams together and automating PA.
            </p>
            <p className="mt-5 max-w-[46ch] text-[clamp(1.05rem,1.25vw,1.6rem)] leading-relaxed text-[var(--muted)]">
              Your cardiologist, pharmacist and primary doctor finally work in the
              same space, and approvals no longer wait on paperwork.
            </p>
            <div className="mt-10 flex flex-wrap gap-3 sm:gap-4">
              <Link href="/login" className="btn-primary">
                Enter care space
              </Link>
              <a href="#pa" className="btn-ghost">
                See how it works
              </a>
            </div>
          </div>

          {/* Live room preview */}
          <div className="relative animate-[fadeRise_0.8s_ease-out]">
            <div className="absolute -inset-6 rounded-[2.5rem] bg-teal-500/10 blur-2xl" aria-hidden />
            <div className="relative overflow-hidden rounded-[2rem] bg-[var(--sidebar)] p-[clamp(1.5rem,2.2vw,3rem)] text-white shadow-[0_40px_90px_rgba(11,18,32,0.35)]">
              <div className="landing-panel-glow" aria-hidden />
              <div className="relative z-[1]">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-teal-300/90">
                      Patient 1 · age 52
                    </p>
                    <p className="font-display mt-2 text-[clamp(1.6rem,2.2vw,2.75rem)] font-bold leading-tight tracking-tight">
                      This morning in the room
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-2 rounded-full bg-teal-400/15 px-3 py-1 text-xs font-semibold text-teal-200">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-teal-300" />
                    4 online
                  </span>
                </div>

                <ol className="relative mt-7 space-y-2 before:absolute before:bottom-4 before:left-[1.35rem] before:top-4 before:w-px before:bg-white/10">
                  {ROOM.map((r, i) => {
                    const on = active === i;
                    return (
                      <li key={r.who} className="relative">
                        <button
                          type="button"
                          onMouseEnter={() => setActive(i)}
                          onFocus={() => setActive(i)}
                          onClick={() => setActive(i)}
                          className={`flex w-full items-start gap-4 rounded-2xl px-2 py-3 text-left transition duration-300 ${
                            on ? "bg-white/10 ring-1 ring-teal-300/35" : "hover:bg-white/5"
                          }`}
                        >
                          <span
                            className={`relative z-[1] flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold transition ${
                              on ? "bg-teal-300 text-[var(--sidebar)]" : "bg-[#1a2436] text-white"
                            }`}
                          >
                            {r.who.slice(-1)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex items-baseline justify-between gap-3">
                              <span className="font-display font-semibold">{r.who}</span>
                              <span className="text-xs text-[var(--sidebar-muted)]">{r.time}</span>
                            </span>
                            <span className="block text-sm text-[var(--sidebar-muted)]">{r.role}</span>
                            <span
                              className={`block text-sm text-teal-100 transition-all duration-300 ${
                                on ? "mt-1 max-h-10 opacity-100" : "max-h-0 opacity-0"
                              }`}
                            >
                              {r.did}
                            </span>
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ol>

                <div className="mt-6 flex items-center justify-between gap-4 rounded-2xl bg-white/[0.06] px-4 py-3 text-sm">
                  <span className="text-[var(--sidebar-muted)]">Next step</span>
                  <span className="font-semibold text-teal-100">Doctor D reviews labs today</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Prior authorization — above the problem */}
      <section id="pa" className="relative z-[1] scroll-mt-16 overflow-hidden bg-[var(--sidebar)] text-white">
        <div className="landing-panel-glow" aria-hidden />
        <div className="site-wrap relative grid items-center gap-12 py-20 lg:grid-cols-2 lg:gap-[5vw] lg:py-28">
          <div>
            <p className="section-kicker !text-teal-300">Prior authorization</p>
            <h2 className="section-title max-w-[16ch] !text-white">Waiting for approval should not cost a life.</h2>
            <p className="mt-6 max-w-[44ch] text-[clamp(1rem,1.2vw,1.45rem)] leading-relaxed text-slate-300">
              Scans, surgeries, procedures and medicines can sit in review for weeks.
              Meanwhile tumors grow, hearts weaken and infections spread. ClearPath
              builds the request from the shared chart the moment a doctor orders care.
            </p>
            <ul className="mt-8 space-y-4 text-[clamp(1rem,1.15vw,1.4rem)] text-[var(--sidebar-muted)]">
              <li className="flex gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-300" />
                Covers medicines, lab and imaging tests, surgeries and procedures.
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-300" />
                Evidence from every doctor on the team is attached automatically.
              </li>
              <li className="flex gap-3">
                <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-teal-300" />
                Urgent cases are flagged so they move to the front of the line.
              </li>
            </ul>
          </div>

          <div className="rounded-[2rem] bg-white p-[clamp(1.5rem,2.2vw,3rem)] text-[var(--ink)] shadow-[0_40px_90px_rgba(0,0,0,0.35)]">
            <div className="flex flex-wrap gap-2" role="tablist" aria-label="Request type">
              {PA_REQUESTS.map((r, i) => (
                <button
                  key={r.type}
                  type="button"
                  role="tab"
                  aria-selected={req === i}
                  onClick={() => pickRequest(i)}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                    req === i
                      ? "bg-[var(--ink)] text-white"
                      : "bg-slate-100 text-slate-600 hover:bg-slate-200"
                  }`}
                >
                  {r.type}
                </button>
              ))}
            </div>
            <div className="mt-6 flex items-center justify-between gap-4">
              <p className="font-display text-[clamp(1.2rem,1.5vw,1.8rem)] font-bold">
                {paRequest.type} approval
              </p>
              <span
                className={`rounded-full px-3 py-1 text-xs font-bold transition ${
                  paReady ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                }`}
              >
                {paReady ? "Ready to submit" : "Drafting"}
              </span>
            </div>
            <dl className="mt-6 divide-y divide-[var(--line)]">
              {paRequest.fields.map(([label, value], i) => {
                const done = filled > i;
                return (
                  <div key={`${req}-${label}`} className="flex items-center justify-between gap-4 py-4">
                    <dt className="text-sm text-[var(--muted)]">{label}</dt>
                    <dd
                      className={`flex items-center gap-2 text-right text-[clamp(0.9rem,1vw,1.15rem)] font-semibold transition-all duration-500 ${
                        done ? "opacity-100" : "opacity-20 blur-[2px]"
                      }`}
                    >
                      {value}
                      <span
                        className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] text-white transition ${
                          done ? "bg-[var(--brand)]" : "bg-slate-300"
                        }`}
                      >
                        ✓
                      </span>
                    </dd>
                  </div>
                );
              })}
            </dl>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section id="problem" className="relative z-[1] scroll-mt-16 border-y border-[var(--line)] bg-white">
        <div className="site-wrap grid gap-12 py-20 lg:grid-cols-[0.8fr_1.2fr] lg:gap-[5vw] lg:py-28">
          <div>
            <p className="section-kicker">The problem</p>
            <h2 className="section-title max-w-[16ch]">Real clinic failures, not slogans.</h2>
            <p className="mt-5 max-w-[40ch] text-[clamp(1rem,1.15vw,1.4rem)] leading-relaxed text-[var(--muted)]">
              These are the kinds of delays and blind spots ClearPath is built to catch
              before a patient deteriorates waiting for the next fax.
            </p>
          </div>
          <ul className="grid gap-4 sm:grid-cols-3 lg:gap-5">
            {PROBLEMS.map(([title, detail], i) => (
              <li
                key={title}
                className="rounded-3xl border border-[var(--line)] bg-[var(--paper)] p-[clamp(1.5rem,2vw,2.5rem)] transition duration-300 hover:-translate-y-1 hover:bg-white hover:shadow-[0_20px_44px_rgba(15,23,42,0.08)]"
              >
                <p className="font-display text-[clamp(2rem,3vw,3.5rem)] font-extrabold leading-none text-rose-500/80">
                  0{i + 1}
                </p>
                <p className="font-display mt-5 text-[clamp(1.2rem,1.5vw,1.8rem)] font-bold leading-tight tracking-tight">
                  {title}
                </p>
                <p className="mt-3 text-[clamp(0.95rem,1vw,1.15rem)] leading-relaxed text-[var(--muted)]">
                  {detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Features */}
      <section className="relative z-[1]">
        <div className="site-wrap py-20 lg:py-28">
          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <p className="section-kicker">What you get</p>
              <h2 className="section-title max-w-[18ch]">What actually ships in the product today.</h2>
            </div>
            <p className="max-w-[38ch] text-[clamp(1rem,1.1vw,1.35rem)] leading-relaxed text-[var(--muted)]">
              Each item maps to a screen or button you can try after you sign in as
              Doctor A.
            </p>
          </div>
          <ul className="mt-12 grid gap-5 sm:grid-cols-2 lg:mt-16 lg:grid-cols-3 lg:gap-6">
            {FEATURES.map(([title, detail], i) => (
              <li
                key={title}
                className="group rounded-3xl border border-[var(--line)] bg-white p-[clamp(1.5rem,2vw,2.5rem)] transition duration-300 hover:-translate-y-1.5 hover:border-teal-700/30 hover:shadow-[0_24px_50px_rgba(15,23,42,0.08)]"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[var(--brand-soft)] font-display text-base font-bold text-teal-900 transition group-hover:bg-[var(--brand)] group-hover:text-white">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <p className="font-display mt-6 text-[clamp(1.25rem,1.5vw,1.8rem)] font-bold tracking-tight">
                  {title}
                </p>
                <p className="mt-2 text-[clamp(0.95rem,1vw,1.15rem)] leading-relaxed text-[var(--muted)]">
                  {detail}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Audience + engines */}
      <section className="relative z-[1]">
        <div className="site-wrap grid gap-16 py-20 lg:grid-cols-[1.2fr_0.8fr] lg:gap-[5vw] lg:py-28">
          <div>
            <p className="section-kicker">Who it helps</p>
            <h2 className="section-title max-w-[16ch]">Everyone around the patient.</h2>
            <ul className="mt-10 grid gap-4 sm:grid-cols-3">
              {AUDIENCE.map(([title, detail]) => (
                <li key={title} className="border-t-2 border-[var(--brand)] pt-5">
                  <p className="font-display text-[clamp(1.15rem,1.4vw,1.7rem)] font-bold">{title}</p>
                  <p className="mt-2 text-[clamp(0.95rem,1vw,1.15rem)] leading-relaxed text-[var(--muted)]">
                    {detail}
                  </p>
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-3xl border border-[var(--line)] bg-white p-[clamp(1.5rem,2vw,2.5rem)]">
            <p className="section-kicker">Under the hood</p>
            <ul className="mt-6 space-y-5">
              {ENGINES.map(([name, job]) => (
                <li key={name} className="flex items-start gap-4">
                  <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-[var(--brand)]" />
                  <span>
                    <span className="font-display block text-[clamp(1.05rem,1.25vw,1.5rem)] font-bold">
                      {name}
                    </span>
                    <span className="text-[clamp(0.9rem,1vw,1.1rem)] text-[var(--muted)]">{job}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="relative z-[1]">
        <div className="site-wrap pb-20 lg:pb-28">
          <div className="relative flex flex-wrap items-center justify-between gap-8 overflow-hidden rounded-[2.5rem] bg-[var(--brand)] px-[clamp(1.75rem,5vw,6rem)] py-[clamp(3rem,5vw,6rem)] text-white">
            <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-white/10 blur-3xl" aria-hidden />
            <h2 className="font-display relative max-w-[16ch] text-[clamp(2.25rem,4.2vw,5.5rem)] font-extrabold leading-[1.02] tracking-tight">
              Ready before your next patient walks in.
            </h2>
            <div className="relative flex flex-wrap gap-3">
              <Link
                href="/login"
                className="rounded-2xl bg-white px-8 py-4 text-lg font-bold text-[var(--brand-deep)] transition duration-300 hover:-translate-y-0.5 hover:shadow-[0_18px_40px_rgba(0,0,0,0.2)]"
              >
                Sign in as a doctor
              </Link>
              <Link
                href="/login"
                className="rounded-2xl border border-white/40 px-8 py-4 text-lg font-semibold text-white transition duration-300 hover:-translate-y-0.5 hover:bg-white/10"
              >
                I am a patient
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="relative z-[1] border-t border-[var(--line)] bg-white">
        <div className="site-wrap flex flex-wrap items-center justify-between gap-4 py-8 text-sm text-[var(--muted)]">
          <p className="font-display text-base font-bold text-[var(--ink)]">ClearPath</p>
          <p>Made at HackGT 13</p>
        </div>
      </footer>
    </main>
  );
}
