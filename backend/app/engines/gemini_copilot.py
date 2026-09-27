"""Gemini Ask — answers across the whole ClearPath care platform.

Uses platform knowledge (all charts, insights, activity) plus the current route
and any page-specific screen payload. Never invents clinical facts.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

from app.config import get_settings

logger = logging.getLogger(__name__)


class ScreenAsk:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._model = None
        if self.settings.gemini_enabled:
            try:
                import google.generativeai as genai

                genai.configure(api_key=self.settings.gemini_api_key)
                self._model = genai.GenerativeModel(self.settings.gemini_model)
            except Exception as exc:  # noqa: BLE001
                logger.warning("Gemini init failed: %s", exc)

    @property
    def enabled(self) -> bool:
        return self._model is not None

    def answer(
        self,
        question: str,
        screen: dict[str, Any],
        viewer_label: str = "clinician",
    ) -> dict[str, Any]:
        q = (question or "").strip()
        if not q:
            return {
                "answer": "Ask anything about ClearPath — patients, medicines, the team, or what's next.",
                "source": "idle",
            }

        fallback = self._fallback(q, screen)

        if not self._model:
            return {"answer": fallback, "source": "chart", "gemini": False}

        route = screen.get("route") or screen.get("tab") or "unknown"
        prompt = f"""You are ClearPath Ask — a quiet helper inside a shared care workspace.
You answer using PLATFORM CONTEXT below (the whole care space) and the current route.
You may use any patient chart, insight totals, activity, briefing, or team data in the context —
not only what is literally visible on the current page.
Do not invent labs, meds, people, or events that are not in the context.
If something is missing, say so in one line and name where in ClearPath to look (Patients, Insights, a patient room, Ava).

FORMAT (strict):
- Line 1: the direct answer in one short sentence. No preamble, no restating the question.
- Then, only if it adds value, up to 4 bullets starting with "- ", each under 15 words.
- Optionally a final line starting with "Next: " naming one concrete step and its owner.
- Use **bold** only for patient, doctor, or medicine names. No headings, tables, emojis, or sign-offs.
- Under 80 words total. Plain language.
Never say you are an AI model. Never mention Gemini.
Viewer: {viewer_label}
Current route: {route}

PLATFORM CONTEXT (JSON):
{json.dumps(screen, indent=2, default=str)[:24000]}

Question: {q}
"""
        try:
            resp = self._model.generate_content(
                prompt,
                generation_config={"temperature": 0.2},
            )
            text = (resp.text or "").strip()
            return {
                "answer": text or fallback,
                "source": "gemini" if text else "chart",
                "gemini": True,
            }
        except Exception as exc:  # noqa: BLE001
            logger.warning("Gemini Ask failed: %s", exc)
            return {"answer": fallback, "source": "chart", "gemini": False, "error": str(exc)}

    def _fallback(self, question: str, screen: dict[str, Any]) -> str:
        patient = screen.get("patient") or {}
        label = patient.get("label") or ""
        conditions = patient.get("conditions") or []
        meds = [
            m
            for m in (patient.get("prescriptions") or [])
            if (m.get("status") or "active") == "active"
        ]
        team = patient.get("team") or []
        briefing = screen.get("briefing") or {}
        platform = screen.get("platform") or {}
        patients = platform.get("patients") or screen.get("patients") or []
        totals = platform.get("totals") or screen.get("totals") or {}
        activity = platform.get("activity") or screen.get("activity") or []
        route = screen.get("route") or screen.get("tab") or ""

        ql = question.lower()

        if any(w in ql for w in ("how many patient", "list patient", "all patient", "who are the patient")):
            if not patients:
                return "I don't see any patients in the care space yet."
            names = ", ".join(
                str(p.get("label") or p.get("patient_id") or p.get("id") or "?") for p in patients[:12]
            )
            return f"There are {len(patients)} patients in ClearPath: {names}."

        if any(w in ql for w in ("insight", "analytics", "overview of care", "totals", "bond")):
            if totals:
                return (
                    f"Care space totals: {totals.get('patients', 0)} patients, "
                    f"{totals.get('active_prescriptions', 0)} active medicines, "
                    f"{totals.get('conditions', 0)} conditions, "
                    f"avg bond {totals.get('avg_bond', '—')}."
                )
            return "Open Insights for live totals across the care space."

        if any(w in ql for w in ("attention", "handoff", "need review", "which patient", "needs care")):
            attn = screen.get("attention") or (patient.get("attention") if isinstance(patient, dict) else None)
            handoffs = platform.get("handoffs") or screen.get("handoffs") or []
            if attn and attn.get("badge") and label:
                return f"{label} attention: {attn.get('badge')} — {(attn.get('flags') or [{}])[0].get('detail', 'See the patient room.')}"
            if handoffs:
                bits = [
                    f"{h.get('patient_label')}: {h.get('next_step') or h.get('attention', {}).get('badge', 'review')}"
                    for h in handoffs[:5]
                ]
                return "Patients needing team attention — " + " · ".join(bits)
            needs = totals.get("needs_attention")
            if needs is not None:
                return f"{needs} patient chart(s) currently need review. Open Patients or Updates for handoffs."
            return "Open Updates for open handoffs, or Patients for attention badges."

        if any(w in ql for w in ("activity", "update", "what happened", "recent")):
            if activity:
                bits = []
                for a in activity[:5]:
                    bits.append(f"{a.get('actor_label', 'Someone')}: {a.get('detail', '')}")
                return "Recent updates — " + " · ".join(bits)
            return "No recent activity is loaded yet — open Updates."

        if any(w in ql for w in ("medicine", "med", "drug", "prescription")):
            if meds and label:
                names = ", ".join(f"{m.get('name')} ({m.get('dose')})" for m in meds[:8])
                return f"{label}'s active medicines: {names}."
            # Platform-wide med scan
            lines = []
            for p in patients[:8]:
                n = p.get("active_prescriptions")
                if n is not None:
                    lines.append(f"{p.get('label')}: {n} active meds")
            if lines:
                return "Active medicines across patients — " + "; ".join(lines) + "."
            return "I don't see medicine details here — open a patient chart."

        if any(w in ql for w in ("condition", "diagnos", "problem", "health")):
            if conditions and label:
                names = ", ".join(c.get("name", "") for c in conditions)
                return f"{label}'s listed conditions: {names}."
            return "Open a patient chart for condition details, or ask about a specific patient."

        if any(w in ql for w in ("team", "doctor", "who")):
            if team and label:
                names = ", ".join(t.get("label", "") for t in team) or "the care team"
                return f"{label} is shared with {names}."
            return "Doctors A–D share every chart in ClearPath. Open Team on a patient for connection scores."

        if any(w in ql for w in ("brief", "next step", "owner", "huddle", "happen next", "what next")):
            if briefing.get("next_step"):
                return (
                    f"Team briefing: {briefing.get('issue', '')}. "
                    f"Owner: {briefing.get('owner', '')}. "
                    f"Next step: {briefing.get('next_step')}."
                )
            if label:
                return f"No briefing loaded for {label} yet — open Talk or refresh the briefing."
            return "No briefing loaded — open a patient Talk tab or refresh the briefing."

        if "patient" in ql and patients and not label:
            names = ", ".join(
                str(p.get("label") or p.get("patient_id") or p.get("id") or "?") for p in patients[:12]
            )
            return f"There are {len(patients)} patients in ClearPath: {names}."

        if label:
            return (
                f"{label}: {len(conditions)} conditions, {len(meds)} active medicines, "
                f"team of {len(team)}. Ask about medicines, conditions, the team, or the whole care space."
            )

        if patients:
            return (
                f"You're in ClearPath ({route or 'care space'}) with {len(patients)} patients. "
                "Ask about a patient, medicines, insights, or recent updates."
            )

        return "Ask about patients, medicines, the care team, insights, or what should happen next."


class PatientHelper(ScreenAsk):
    def plain_summary(self, patient, question: Optional[str] = None) -> str:
        screen = {
            "tab": "My care",
            "route": "/app/me",
            "patient": patient.model_dump() if hasattr(patient, "model_dump") else patient,
        }
        return self.answer(
            question or "What does my care team already know about me?",
            screen,
            viewer_label="patient",
        )["answer"]
