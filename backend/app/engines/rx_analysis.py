"""Prescription safety analysis for shared multi-doctor charts.

Uses OpenAI when configured; otherwise deterministic heuristics so demos work
without a key. Flags conflicts that may affect regimens from other doctors.
"""
from __future__ import annotations

import json
import logging
import re
from typing import Any

from app.config import get_settings
from app.models.schemas import Patient, Prescription

logger = logging.getLogger(__name__)

# Simple class / alias groups for heuristic duplicate detection
MED_CLASSES: dict[str, set[str]] = {
    "ace_inhibitor": {"lisinopril", "enalapril", "ramipril", "benazepril"},
    "arb": {"losartan", "valsartan", "olmesartan", "candesartan"},
    "beta_blocker": {"carvedilol", "metoprolol", "atenolol", "propranolol", "bisoprolol"},
    "loop_diuretic": {"furosemide", "bumetanide", "torsemide"},
    "sglt2": {"empagliflozin", "dapagliflozin", "canagliflozin"},
    "biguanide": {"metformin"},
    "doac": {"apixaban", "rivaroxaban", "dabigatran", "edoxaban"},
    "warfarin": {"warfarin"},
    "nsaid": {"ibuprofen", "naproxen", "diclofenac", "meloxicam"},
    "opioid": {"oxycodone", "hydrocodone", "morphine", "tramadol", "codeine"},
    "gabapentinoid": {"gabapentin", "pregabalin"},
    "ssri": {"sertraline", "fluoxetine", "escitalopram", "citalopram", "paroxetine"},
    "statin": {"atorvastatin", "simvastatin", "rosuvastatin", "pravastatin"},
}

# Pairwise conflict rules: (class_a, class_b) -> message
CLASS_CONFLICTS: list[tuple[str, str, str, str]] = [
    (
        "ace_inhibitor",
        "arb",
        "high",
        "ACE inhibitor + ARB together raises hyperkalemia and kidney risk — usually avoided.",
    ),
    (
        "doac",
        "nsaid",
        "high",
        "Blood thinner + NSAID increases bleeding risk.",
    ),
    (
        "warfarin",
        "nsaid",
        "high",
        "Warfarin + NSAID significantly increases bleeding risk.",
    ),
    (
        "doac",
        "opioid",
        "medium",
        "Sedating opioids with anticoagulation: watch falls/bleeding risk.",
    ),
    (
        "sglt2",
        "loop_diuretic",
        "medium",
        "SGLT2 + loop diuretic can amplify volume depletion — review hydration and labs.",
    ),
    (
        "nsaid",
        "ace_inhibitor",
        "medium",
        "NSAID + ACE inhibitor can worsen kidney function, especially with CKD.",
    ),
    (
        "nsaid",
        "arb",
        "medium",
        "NSAID + ARB can worsen kidney function.",
    ),
]

CONDITION_FLAGS: list[tuple[str, set[str], str, str]] = [
    (
        "nsaid",
        {"chronic kidney", "ckd", "kidney disease"},
        "high",
        "NSAIDs are generally avoided in chronic kidney disease.",
    ),
    (
        "nsaid",
        {"heart failure"},
        "high",
        "NSAIDs can worsen heart failure fluid retention.",
    ),
    (
        "nsaid",
        {"atrial fibrillation", "stroke"},
        "medium",
        "NSAID with stroke-risk / AF care may add bleeding risk if anticoagulated.",
    ),
]


def _norm(name: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (name or "").lower())


def _med_classes(name: str) -> set[str]:
    n = _norm(name)
    found: set[str] = set()
    for cls, members in MED_CLASSES.items():
        for m in members:
            if m in n or n in m:
                found.add(cls)
                break
    return found


def _doctor_label(patient: Patient, doctor_id: str) -> str:
    for m in patient.team:
        if m.id == doctor_id:
            return m.label
    return doctor_id


class RxAnalyzer:
    def __init__(self) -> None:
        self.settings = get_settings()
        self._client = None
        if self.settings.openai_enabled:
            try:
                from openai import OpenAI

                self._client = OpenAI(api_key=self.settings.openai_api_key)
            except Exception as exc:  # noqa: BLE001
                logger.warning("OpenAI init failed: %s", exc)

    @property
    def enabled(self) -> bool:
        return self._client is not None

    def analyze(
        self,
        patient: Patient,
        *,
        name: str,
        dose: str,
        frequency: str,
        reason: str,
        proposing_doctor_id: str,
        proposing_doctor_label: str,
    ) -> dict[str, Any]:
        proposed = {
            "name": name.strip(),
            "dose": dose.strip(),
            "frequency": frequency.strip(),
            "reason": reason.strip(),
            "proposed_by": proposing_doctor_label,
            "proposed_by_id": proposing_doctor_id,
        }
        active = [rx for rx in patient.prescriptions if rx.status == "active"]
        heuristic = self._heuristic(patient, proposed, active)

        if not self._client:
            heuristic["engine"] = "heuristic"
            heuristic["openai"] = False
            return heuristic

        try:
            llm = self._openai_analyze(patient, proposed, active, heuristic)
            llm["engine"] = "openai"
            llm["openai"] = True
            # Keep heuristic findings if the model omitted them
            if not llm.get("findings") and heuristic.get("findings"):
                llm["findings"] = heuristic["findings"]
            return llm
        except Exception as exc:  # noqa: BLE001
            logger.warning("OpenAI Rx analysis failed: %s", exc)
            heuristic["engine"] = "heuristic"
            heuristic["openai"] = False
            heuristic["error"] = str(exc)
            return heuristic

    def _openai_analyze(
        self,
        patient: Patient,
        proposed: dict[str, Any],
        active: list[Prescription],
        heuristic: dict[str, Any],
    ) -> dict[str, Any]:
        others = [
            {
                "name": rx.name,
                "dose": rx.dose,
                "prescribed_by": _doctor_label(patient, rx.prescribed_by),
                "prescribed_by_id": rx.prescribed_by,
                "reason": rx.reason,
            }
            for rx in active
            if rx.prescribed_by != proposed["proposed_by_id"]
        ]
        same_doc = [
            {
                "name": rx.name,
                "dose": rx.dose,
                "prescribed_by": _doctor_label(patient, rx.prescribed_by),
                "reason": rx.reason,
            }
            for rx in active
            if rx.prescribed_by == proposed["proposed_by_id"]
        ]
        payload = {
            "patient": {
                "label": patient.label,
                "age": patient.age,
                "conditions": [
                    {"name": c.name, "note": c.note, "status": c.status}
                    for c in patient.conditions
                ],
            },
            "proposed": proposed,
            "active_from_other_doctors": others,
            "active_from_proposing_doctor": same_doc,
            "heuristic_hints": heuristic.get("findings", []),
        }
        system = (
            "You are ClearPath prescription safety reviewer for a SHARED multi-doctor care chart. "
            "Doctors A–D all prescribe into one patient chart. Analyze the proposed Rx against "
            "conditions and ALL active medicines, especially those from OTHER doctors. "
            "Never invent labs or diagnoses not in the JSON. "
            "Return ONLY valid JSON with keys: "
            "severity (ok|review|caution|avoid), "
            "summary (1-2 sentences plain language), "
            "recommendation (1-3 sentences actionable for the proposing doctor), "
            "findings (array of {severity, kind, title, detail, affects_other_doctors:bool, related_doctors:string[]}), "
            "impacts_other_regimens (bool). "
            "kinds: interaction|duplication|contraindication|cross_doctor|monitoring. "
            "Be concise. Clinical decision support only — not a substitute for clinical judgment."
        )
        resp = self._client.chat.completions.create(
            model=self.settings.openai_model,
            temperature=0.2,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": system},
                {
                    "role": "user",
                    "content": json.dumps(payload, indent=2, default=str)[:20000],
                },
            ],
        )
        text = (resp.choices[0].message.content or "").strip()
        data = json.loads(text)
        return {
            "severity": data.get("severity") or heuristic.get("severity") or "review",
            "summary": data.get("summary") or heuristic.get("summary") or "",
            "recommendation": data.get("recommendation")
            or heuristic.get("recommendation")
            or "",
            "findings": data.get("findings") or [],
            "impacts_other_regimens": bool(
                data.get("impacts_other_regimens", heuristic.get("impacts_other_regimens"))
            ),
            "proposed": proposed,
        }

    def _heuristic(
        self,
        patient: Patient,
        proposed: dict[str, Any],
        active: list[Prescription],
    ) -> dict[str, Any]:
        findings: list[dict[str, Any]] = []
        prop_name = proposed["name"]
        prop_norm = _norm(prop_name)
        prop_classes = _med_classes(prop_name)
        proposing_id = proposed["proposed_by_id"]

        # Exact / near-duplicate name
        for rx in active:
            rx_norm = _norm(rx.name)
            if prop_norm and (prop_norm == rx_norm or prop_norm in rx_norm or rx_norm in prop_norm):
                other = rx.prescribed_by != proposing_id
                findings.append(
                    {
                        "severity": "caution" if other else "review",
                        "kind": "duplication",
                        "title": f"Possible duplicate of {rx.name}",
                        "detail": (
                            f"Already active at {rx.dose} from {_doctor_label(patient, rx.prescribed_by)}. "
                            + (
                                "Coordinate before adding another agent from a different doctor."
                                if other
                                else "Confirm this is intentional dose change, not a second start."
                            )
                        ),
                        "affects_other_doctors": other,
                        "related_doctors": [_doctor_label(patient, rx.prescribed_by)],
                    }
                )

        # Same-class duplicates
        for rx in active:
            shared = prop_classes & _med_classes(rx.name)
            if not shared:
                continue
            if any(f.get("title", "").endswith(rx.name) for f in findings):
                continue
            other = rx.prescribed_by != proposing_id
            cls = next(iter(shared))
            findings.append(
                {
                    "severity": "caution" if other else "review",
                    "kind": "duplication",
                    "title": f"Same class as {rx.name} ({cls.replace('_', ' ')})",
                    "detail": (
                        f"{prop_name} and {rx.name} may overlap therapeutically. "
                        f"Current Rx from {_doctor_label(patient, rx.prescribed_by)}."
                    ),
                    "affects_other_doctors": other,
                    "related_doctors": [_doctor_label(patient, rx.prescribed_by)],
                }
            )

        # Class-pair conflicts
        for cls_a, cls_b, sev, msg in CLASS_CONFLICTS:
            if cls_a not in prop_classes and cls_b not in prop_classes:
                continue
            need = cls_b if cls_a in prop_classes else cls_a
            for rx in active:
                if need not in _med_classes(rx.name):
                    continue
                other = rx.prescribed_by != proposing_id
                findings.append(
                    {
                        "severity": sev,
                        "kind": "interaction",
                        "title": f"Interaction with {rx.name}",
                        "detail": msg
                        + f" Existing med prescribed by {_doctor_label(patient, rx.prescribed_by)}.",
                        "affects_other_doctors": other,
                        "related_doctors": [_doctor_label(patient, rx.prescribed_by)],
                    }
                )

        # Condition contraindications
        cond_text = " ".join(c.name.lower() for c in patient.conditions)
        for cls, needles, sev, msg in CONDITION_FLAGS:
            if cls not in prop_classes:
                continue
            if any(n in cond_text for n in needles):
                findings.append(
                    {
                        "severity": sev,
                        "kind": "contraindication",
                        "title": f"Condition concern for {prop_name}",
                        "detail": msg,
                        "affects_other_doctors": False,
                        "related_doctors": [],
                    }
                )

        # Cross-doctor impact signal
        other_docs = sorted(
            {
                _doctor_label(patient, rx.prescribed_by)
                for rx in active
                if rx.prescribed_by != proposing_id
            }
        )
        impacts = any(f.get("affects_other_doctors") for f in findings)
        if other_docs and not impacts and prop_name:
            findings.append(
                {
                    "severity": "ok",
                    "kind": "cross_doctor",
                    "title": "Shared chart check",
                    "detail": (
                        f"No hard conflict detected vs medicines from {', '.join(other_docs)}. "
                        "Still confirm with the team if this changes goals of care."
                    ),
                    "affects_other_doctors": False,
                    "related_doctors": other_docs,
                }
            )

        severity = _roll_up(findings)
        summary = _summary_line(prop_name, severity, findings, impacts)
        recommendation = _recommend(severity, findings, proposing_label=proposed["proposed_by"])

        return {
            "severity": severity,
            "summary": summary,
            "recommendation": recommendation,
            "findings": findings,
            "impacts_other_regimens": impacts,
            "proposed": proposed,
        }


def _roll_up(findings: list[dict[str, Any]]) -> str:
    order = {"ok": 0, "review": 1, "caution": 2, "avoid": 3, "high": 3, "medium": 2}
    # Map legacy high/medium on findings into severity scale
    best = 0
    for f in findings:
        s = f.get("severity") or "ok"
        if s == "high":
            s = "avoid"
            f["severity"] = "avoid"
        elif s == "medium":
            s = "caution"
            f["severity"] = "caution"
        best = max(best, order.get(s, 1))
    return {0: "ok", 1: "review", 2: "caution", 3: "avoid"}[best]


def _summary_line(
    name: str, severity: str, findings: list[dict[str, Any]], impacts: bool
) -> str:
    n = len([f for f in findings if f.get("severity") not in ("ok",)])
    if severity == "ok":
        return f"{name or 'Proposed medicine'} looks compatible with the shared chart on a quick check."
    if impacts:
        return (
            f"{name} needs team review — {n} finding(s), including possible impact on "
            "medicines from other doctors."
        )
    return f"{name} has {n} finding(s) to review before adding to the shared chart."


def _recommend(
    severity: str, findings: list[dict[str, Any]], proposing_label: str
) -> str:
    if severity == "ok":
        return (
            f"{proposing_label} can add this after a quick team glance; "
            "log it so Doctors A–D see the change."
        )
    if severity == "avoid":
        return (
            "Do not add yet — resolve the high-severity finding with the prescribing "
            "colleague(s) and document the decision in Talk."
        )
    if severity == "caution":
        return (
            "Pause and align with the other doctor(s) named in the findings before "
            "writing this to the shared chart."
        )
    return "Review the findings, then either adjust the plan or confirm with the care team in Talk."
