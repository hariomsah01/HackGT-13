"""Shared-care signals: attention, handoffs, last activity across doctors."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from app.models.schemas import Patient
from app.services.store import CareStore


# Meds that commonly need multi-doctor awareness in demo profiles
HIGH_TOUCH = {
    "apixaban",
    "warfarin",
    "empagliflozin",
    "furosemide",
    "metformin",
}


def _parse_ts(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    try:
        return datetime.fromisoformat(ts.replace("Z", ""))
    except ValueError:
        return None


def doctor_last_activity(
    store: CareStore, patient_id: str, team_ids: list[str]
) -> list[dict[str, Any]]:
    """Per-doctor last touch from activity + live presence."""
    feed = store.activity_feed(patient_id=patient_id, limit=80)
    presence = {p["id"]: p for p in store.get_presence(patient_id)}
    last: dict[str, dict[str, Any]] = {}
    for ev in feed:
        if ev.kind in ("viewed", "ask"):
            continue
        if ev.actor_id not in team_ids and not ev.actor_id.startswith("doctor_"):
            continue
        if ev.actor_id in last:
            continue
        last[ev.actor_id] = {
            "id": ev.actor_id,
            "label": ev.actor_label,
            "kind": ev.kind,
            "detail": ev.detail,
            "at": ev.timestamp,
            "viewing_now": ev.actor_id in presence,
        }
    # Merge anyone currently present who has no activity yet
    for uid, meta in presence.items():
        if uid not in last:
            last[uid] = {
                "id": uid,
                "label": meta.get("label", uid),
                "kind": "presence",
                "detail": "In the room now",
                "at": meta.get("seen_at"),
                "viewing_now": True,
            }
        else:
            last[uid]["viewing_now"] = True
            last[uid]["seen_at"] = meta.get("seen_at")
    return sorted(
        last.values(),
        key=lambda r: r.get("at") or "",
        reverse=True,
    )


def care_attention(patient: Patient, briefing: Optional[dict] = None) -> dict[str, Any]:
    """Lightweight conflict / attention badge for shared charts."""
    flags: list[dict[str, str]] = []
    active = [rx for rx in patient.prescriptions if rx.status == "active"]
    prescribers = {rx.prescribed_by for rx in active}
    cond_text = " ".join(c.name.lower() for c in patient.conditions)

    if len(prescribers) >= 2:
        labels = sorted(
            {
                next((m.label for m in patient.team if m.id == d), d)
                for d in prescribers
            }
        )
        flags.append(
            {
                "level": "info",
                "code": "multi_prescriber",
                "title": "Shared regimen",
                "detail": f"Active medicines from {', '.join(labels)}. Align before changing doses.",
                "patient_title": "Medicines from more than one doctor",
                "patient_detail": (
                    f"Your active medicines come from {', '.join(labels)}. "
                    "Ask before starting or stopping any of them."
                ),
            }
        )

    # CKD + SGLT2 / ACE / diuretic awareness
    if "kidney" in cond_text or "ckd" in cond_text:
        kidney_meds = [
            rx.name
            for rx in active
            if any(
                k in rx.name.lower()
                for k in ("empagliflozin", "lisinopril", "furosemide", "metformin")
            )
        ]
        if kidney_meds:
            flags.append(
                {
                    "level": "review",
                    "code": "kidney_meds",
                    "title": "Kidney + medicines",
                    "detail": f"CKD chart includes {', '.join(kidney_meds)}. Labs and dose review matter.",
                    "patient_title": "Kidney care and your medicines",
                    "patient_detail": (
                        f"Your kidney plan includes {', '.join(kidney_meds)}. "
                        "Keep your lab visits so doses stay safe."
                    ),
                }
            )

    if "heart failure" in cond_text or "atrial fibrillation" in cond_text:
        blood_thinners = [
            rx.name
            for rx in active
            if any(k in rx.name.lower() for k in ("apixaban", "warfarin", "rivaroxaban"))
        ]
        if blood_thinners:
            flags.append(
                {
                    "level": "caution",
                    "code": "anticoag",
                    "title": "Anticoagulation active",
                    "detail": (
                        f"{', '.join(blood_thinners)} on chart. "
                        "Bleeding risk if another doctor adds NSAIDs or procedures."
                    ),
                    "patient_title": "Blood thinner alert",
                    "patient_detail": (
                        f"You take {', '.join(blood_thinners)}. "
                        "Tell every doctor and dentist before new medicines or procedures."
                    ),
                }
            )

    high = [rx.name for rx in active if any(h in rx.name.lower() for h in HIGH_TOUCH)]
    if len(high) >= 3 and not any(f["code"] == "kidney_meds" for f in flags):
        flags.append(
            {
                "level": "review",
                "code": "polypharmacy",
                "title": "Busy medicine list",
                "detail": f"{len(active)} active meds on one shared chart. Good moment for a team med review.",
                "patient_title": "Many medicines on your list",
                "patient_detail": (
                    f"You have {len(active)} active medicines. "
                    "Bring your full list to each visit."
                ),
            }
        )

    if briefing and briefing.get("open_question"):
        flags.append(
            {
                "level": "handoff",
                "code": "open_question",
                "title": "Open team question",
                "detail": str(briefing.get("open_question")),
                "patient_title": "Your care team has an open item",
                "patient_detail": (
                    "Your doctors are still closing one question on your plan. "
                    "Check Messages if they asked you for anything."
                ),
            }
        )

    level_rank = {"info": 0, "handoff": 1, "review": 2, "caution": 3}
    top = max((level_rank.get(f["level"], 0) for f in flags), default=0)
    level = {0: "clear", 1: "handoff", 2: "review", 3: "caution"}.get(top, "clear")
    if not flags:
        level = "clear"

    return {
        "level": level,
        "badge": {
            "clear": "Clear",
            "handoff": "Handoff",
            "review": "Needs review",
            "caution": "Attention",
        }.get(level, "Clear"),
        "flags": flags,
        "multi_doctor_rx": len(prescribers) >= 2,
        "active_prescriptions": len(active),
        "prescriber_count": len(prescribers),
    }


def handoff_pack(
    patient: Patient,
    store: CareStore,
    briefing: Optional[dict] = None,
) -> dict[str, Any]:
    """Open questions + next steps surfaced for room + updates."""
    briefing = briefing or store.get_briefing(patient.id) or {}
    tasks = store.list_tasks(patient.id)
    open_tasks = [t for t in tasks if (t.get("status") or "open") != "done"]
    attention = care_attention(patient, briefing)
    team_ids = [m.id for m in patient.team]
    return {
        "patient_id": patient.id,
        "patient_label": patient.label,
        "open_question": briefing.get("open_question") or "",
        "owner": briefing.get("owner") or "",
        "next_step": briefing.get("next_step") or "",
        "issue": briefing.get("issue") or "",
        "for_patient": briefing.get("for_patient") or "",
        "tasks": open_tasks[:5],
        "attention": attention,
        "team_activity": doctor_last_activity(store, patient.id, team_ids),
        "updated_at": briefing.get("updated_at"),
    }
