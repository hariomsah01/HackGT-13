"""Connection intelligence — who should talk to whom, and why.

Deterministic scoring over the shared chart + room activity.
Makes the care graph feel alive for Meta judging (human connection).
"""
from __future__ import annotations

from collections import defaultdict
from typing import Any

from app.models.schemas import CareRoom, Patient


def connection_report(patient: Patient, room: CareRoom | None) -> dict[str, Any]:
    # Doctor → patient strength from prescriptions + treatments + notes
    strength: dict[str, float] = {m.id: 35.0 for m in patient.team}
    reasons: dict[str, list[str]] = defaultdict(list)

    for rx in patient.prescriptions:
        if rx.status == "active" and rx.prescribed_by in strength:
            strength[rx.prescribed_by] += 18
            reasons[rx.prescribed_by].append(f"Prescribes {rx.name}")

    for tx in patient.treatments:
        if tx.led_by in strength:
            strength[tx.led_by] += 14
            reasons[tx.led_by].append(f"Leads {tx.name}")

    for note in patient.notes:
        if note.author_id in strength:
            strength[note.author_id] += 8
            reasons[note.author_id].append("Recent chart note")

    if room:
        for msg in room.messages[-12:]:
            if msg.author_id in strength:
                strength[msg.author_id] += 6
                reasons[msg.author_id].append("Active in team room")

    # Cross-doctor links when meds/treatments span specialties
    bridges = []
    prescribers = {rx.prescribed_by for rx in patient.prescriptions if rx.status == "active"}
    if len(prescribers) >= 2:
        bridges.append(
            {
                "type": "shared_medicines",
                "doctors": sorted(prescribers),
                "why": "More than one doctor is prescribing — keep the list reconciled.",
            }
        )
    leaders = {tx.led_by for tx in patient.treatments if tx.status == "active"}
    if leaders and prescribers - leaders:
        bridges.append(
            {
                "type": "treatment_overlap",
                "doctors": sorted(leaders | prescribers),
                "why": "Treatment owners and prescribing doctors should stay aligned.",
            }
        )

    members = []
    for m in patient.team:
        score = min(100.0, strength.get(m.id, 30.0))
        members.append(
            {
                "id": m.id,
                "label": m.label,
                "specialty": m.specialty,
                "role": m.role,
                "connection_score": round(score, 1),
                "closeness": "close" if score >= 70 else "warming" if score >= 45 else "light",
                "reasons": reasons.get(m.id, ["On care team"])[:3],
            }
        )
    members.sort(key=lambda x: -x["connection_score"])

    # Who to pull into the next huddle
    suggest = [m for m in members if m["closeness"] != "light"][:3]
    if len(suggest) < 2:
        suggest = members[:2]

    return {
        "patient_id": patient.id,
        "patient_label": patient.label,
        "team_connection": members,
        "bridges": bridges,
        "suggest_next_huddle": [m["label"] for m in suggest],
        "bond_score": round(
            sum(m["connection_score"] for m in members) / max(len(members), 1), 1
        ),
        "headline": (
            f"{patient.label} is tightly connected to "
            + ", ".join(m["label"] for m in members[:2])
            + (" and the wider team." if len(members) > 2 else ".")
        ),
    }
