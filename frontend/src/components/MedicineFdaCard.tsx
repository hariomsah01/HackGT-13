"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { FdaProfile } from "@/lib/types";

function Section({ title, text, tone = "plain" }: { title: string; text?: string; tone?: "plain" | "warn" }) {
  const [open, setOpen] = useState(false);
  if (!text) return null;
  const long = text.length > 260;
  return (
    <section
      className={`rounded-2xl px-4 py-3 ${
        tone === "warn" ? "border border-rose-200 bg-rose-50 text-rose-950" : "bg-[var(--paper)] text-[var(--ink)]"
      }`}
    >
      <p
        className={`text-[10px] font-bold uppercase tracking-[0.16em] ${
          tone === "warn" ? "text-rose-700" : "text-[var(--brand)]"
        }`}
      >
        {title}
      </p>
      <p className={`mt-1.5 text-sm leading-relaxed ${!open && long ? "line-clamp-4" : ""}`}>{text}</p>
      {long && (
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="mt-1 text-xs font-semibold text-[var(--brand)] hover:underline"
        >
          {open ? "Show less" : "Show more"}
        </button>
      )}
    </section>
  );
}

export function MedicineFdaCard({
  name,
  dose,
  patientId,
  patientLabel,
  onClose,
  onAskAva,
}: {
  name: string;
  dose?: string;
  patientId?: string;
  patientLabel?: string;
  onClose: () => void;
  onAskAva?: (name: string) => void;
}) {
  const { token } = useAuth();
  const [profile, setProfile] = useState<FdaProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setProfile(null);
    setError(null);
    api
      .fdaDrug(name, token, patientId)
      .then((p) => !cancelled && setProfile(p))
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "openFDA is unavailable"));
    return () => {
      cancelled = true;
    };
  }, [name, patientId, token]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const faers = profile?.faers;
  const maxCount = Math.max(1, ...(faers?.top_reactions.map((r) => r.count) ?? [1]));
  const seriousPct =
    faers && faers.total_reports ? Math.round((faers.serious_reports / faers.total_reports) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex justify-end" role="dialog" aria-modal="true" aria-label={`${name} FDA information`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]" />
      <aside className="relative flex h-full w-full max-w-xl flex-col overflow-hidden bg-white shadow-2xl">
        <header className="border-b border-[var(--line)] bg-gradient-to-br from-sky-50 to-teal-50 px-6 py-5">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-sky-800">
                <span className="rounded bg-sky-700 px-1.5 py-0.5 text-[9px] font-extrabold text-white">FDA</span>
                openFDA medicine profile
              </p>
              <h2 className="font-display mt-2 text-2xl font-extrabold tracking-tight text-[var(--ink)]">
                {profile?.generic_name || name}
              </h2>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {[dose && `${patientLabel ? `${patientLabel} takes ` : ""}${dose}`, profile?.route, profile?.drug_class?.replace(/\s*\[EPC\]/g, "")]
                  .filter(Boolean)
                  .join(" · ")}
              </p>
              {!!profile?.brand_names?.length && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {profile.brand_names.map((b) => (
                    <span key={b} className="rounded-full bg-white px-2.5 py-0.5 text-xs font-semibold text-sky-900 ring-1 ring-sky-200">
                      {b}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-[var(--line)] bg-white px-2.5 py-1 text-sm font-semibold text-[var(--muted)] hover:text-[var(--ink)]"
            >
              ✕
            </button>
          </div>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {!profile && !error && (
            <div className="space-y-3" aria-busy>
              <p className="text-sm text-[var(--muted)]">Pulling the label, products and adverse event reports from openFDA…</p>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-2xl bg-slate-100" />
              ))}
            </div>
          )}
          {error && <p className="rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</p>}
          {profile && !profile.found && (
            <p className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-900">
              openFDA has no label or reports for “{name}”. Check the spelling or search by generic name.
            </p>
          )}

          {profile?.found && (
            <>
              <Section title="Boxed warning" text={profile.boxed_warning} tone="warn" />
              <Section title="What it treats" text={profile.indications} />
              <Section title="Most common side effects" text={profile.side_effects} />
              <Section title="How it's dosed" text={profile.dosage} />
              <Section title="Key warnings" text={profile.warnings} />
              <Section title="Interactions" text={profile.interactions} />
              <Section title="What to tell the patient" text={profile.patient_info} />

              {faers && faers.total_reports > 0 && (
                <section className="rounded-2xl border border-[var(--line)] px-4 py-4">
                  <div className="flex flex-wrap items-end justify-between gap-2">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                        Real-world reports to FDA (FAERS)
                      </p>
                      <p className="font-display mt-1 text-xl font-bold text-[var(--ink)]">
                        {faers.total_reports.toLocaleString()} reports
                      </p>
                    </div>
                    <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 ring-1 ring-amber-200">
                      {seriousPct}% marked serious
                    </span>
                  </div>
                  <ul className="mt-4 space-y-2">
                    {faers.top_reactions.map((r) => (
                      <li key={r.term} className="grid grid-cols-[9rem_1fr_auto] items-center gap-3 text-xs">
                        <span className="truncate font-semibold text-[var(--ink)]" title={r.term}>
                          {r.term}
                        </span>
                        <span className="h-2.5 overflow-hidden rounded-full bg-slate-100">
                          <span
                            className="block h-full rounded-full bg-gradient-to-r from-teal-500 to-sky-500"
                            style={{ width: `${Math.max(4, (r.count / maxCount) * 100)}%` }}
                          />
                        </span>
                        <span className="tabular-nums text-[var(--muted)]">{r.count.toLocaleString()}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mt-3 text-[11px] leading-relaxed text-[var(--muted)]">
                    Voluntary reports from patients and clinicians. A report does not prove the medicine caused the reaction.
                  </p>
                </section>
              )}

              {!!profile.products.length && (
                <section className="rounded-2xl border border-[var(--line)] px-4 py-4">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[var(--brand)]">
                    On the market (NDC directory)
                  </p>
                  <ul className="mt-3 divide-y divide-[var(--line)]">
                    {profile.products.map((p, i) => (
                      <li key={`${p.labeler}-${p.strength}-${i}`} className="flex items-start justify-between gap-3 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="font-semibold text-[var(--ink)]">
                            {p.brand || profile.generic_name}{" "}
                            <span className="font-normal text-[var(--muted)]">{p.strength}</span>
                          </p>
                          <p className="truncate text-xs text-[var(--muted)]">
                            {p.form} · {p.labeler}
                          </p>
                        </div>
                        <span
                          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold ${
                            p.category === "NDA" || p.category === "BLA"
                              ? "bg-violet-50 text-violet-800"
                              : "bg-slate-100 text-slate-700"
                          }`}
                        >
                          {p.category === "NDA" || p.category === "BLA" ? "Brand" : p.category === "ANDA" ? "Generic" : p.category || "Other"}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}
            </>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--line)] bg-[var(--paper)] px-6 py-4">
          <div className="flex flex-wrap gap-3 text-xs font-semibold">
            {profile?.sources.label && (
              <a href={profile.sources.label} target="_blank" rel="noreferrer" className="text-sky-800 hover:underline">
                Full FDA label (DailyMed) ↗
              </a>
            )}
            <a href="https://open.fda.gov/" target="_blank" rel="noreferrer" className="text-[var(--muted)] hover:underline">
              Source: openFDA ↗
            </a>
          </div>
          {onAskAva && profile?.found && (
            <button
              type="button"
              onClick={() => onAskAva(name)}
              className="rounded-xl bg-[var(--brand)] px-4 py-2 text-sm font-bold text-white transition hover:bg-[var(--brand-deep)]"
            >
              Explain to {patientLabel || "patient"} with Ava
            </button>
          )}
        </footer>
      </aside>
    </div>
  );
}
