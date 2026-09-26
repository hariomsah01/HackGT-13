"""Generate Patient 1, Patient 2, … with a full care team Doctor A–D."""
from __future__ import annotations

import random
from datetime import date, timedelta
from typing import Optional

from app.engines.auth import doctor_team
from app.models.schemas import (
    CareMember,
    Condition,
    Note,
    Patient,
    Prescription,
    Report,
    Treatment,
)

PROFILES = [
    {
        "focus": "metabolic",
        "conditions": [
            ("Type 2 diabetes", "Ongoing blood sugar management"),
            ("High blood pressure", "Monitored by primary care and cardiology"),
            ("Chronic kidney disease, stage 3", "Followed by nephrology"),
        ],
        "meds": [
            ("Metformin", "1000 mg twice daily", "doctor_a", "Blood sugar"),
            ("Lisinopril", "20 mg daily", "doctor_a", "Blood pressure"),
            ("Empagliflozin", "10 mg daily", "doctor_d", "Kidney and heart protection"),
        ],
        "treatments": [
            ("Diabetes care plan", "doctor_b", "Diet, glucose checks, specialist visits"),
            ("Kidney monitoring", "doctor_d", "Labs every 3 months"),
        ],
        "labs": [
            ("HbA1c", "8.2", "%"),
            ("eGFR", "52", "mL/min"),
            ("Blood pressure", "138/84", "mmHg"),
        ],
    },
    {
        "focus": "heart",
        "conditions": [
            ("Heart failure", "Managed with cardiology"),
            ("Atrial fibrillation", "Rhythm and stroke-risk care"),
            ("High blood pressure", "Shared with primary care"),
        ],
        "meds": [
            ("Apixaban", "5 mg twice daily", "doctor_c", "Stroke prevention"),
            ("Carvedilol", "12.5 mg twice daily", "doctor_c", "Heart rate and blood pressure"),
            ("Furosemide", "20 mg daily", "doctor_c", "Fluid control"),
        ],
        "treatments": [
            ("Heart failure pathway", "doctor_c", "Weight checks, salt limits, follow-up"),
            ("Medication review", "doctor_a", "Keep the full list aligned across doctors"),
        ],
        "labs": [
            ("BNP", "220", "pg/mL"),
            ("Potassium", "4.2", "mEq/L"),
            ("Creatinine", "1.1", "mg/dL"),
        ],
    },
    {
        "focus": "spine",
        "conditions": [
            ("Lumbar radiculopathy", "Back and leg nerve pain"),
            ("Obesity", "Weight management support"),
            ("High blood pressure", "Primary care follow-up"),
        ],
        "meds": [
            ("Gabapentin", "300 mg three times daily", "doctor_a", "Nerve pain"),
            ("Lisinopril", "10 mg daily", "doctor_a", "Blood pressure"),
        ],
        "treatments": [
            ("Physical therapy course", "doctor_a", "12 sessions completed"),
            ("Specialist review", "doctor_b", "Next steps if pain persists"),
        ],
        "labs": [
            ("Blood pressure", "132/80", "mmHg"),
            ("BMI", "31.4", ""),
        ],
    },
]


def _ago(days: int) -> str:
    return (date.today() - timedelta(days=days)).isoformat()


def generate_patient(index: int, seed: Optional[int] = None) -> Patient:
    rng = random.Random(seed if seed is not None else 1000 + index)
    profile = PROFILES[(index - 1) % len(PROFILES)]
    team = [CareMember(**d) for d in doctor_team()]

    conditions = [
        Condition(
            id=f"c{i+1}",
            name=name,
            since=_ago(rng.randint(200, 1400)),
            note=note,
        )
        for i, (name, note) in enumerate(profile["conditions"])
    ]

    prescriptions = [
        Prescription(
            id=f"rx{i+1}",
            name=name,
            dose=dose,
            started=_ago(rng.randint(30, 400)),
            prescribed_by=by,
            reason=reason,
        )
        for i, (name, dose, by, reason) in enumerate(profile["meds"])
    ]

    # One stopped med so history is visible
    prescriptions.append(
        Prescription(
            id="rx_old",
            name="Glipizide" if profile["focus"] == "metabolic" else "Ibuprofen",
            dose="5 mg daily" if profile["focus"] == "metabolic" else "as needed",
            status="stopped",
            started=_ago(300),
            stopped=_ago(60),
            prescribed_by="doctor_a",
            reason="Stopped after team review",
        )
    )

    treatments = [
        Treatment(
            id=f"tx{i+1}",
            name=name,
            started=_ago(rng.randint(20, 180)),
            led_by=led,
            detail=detail,
            status="active" if i == 0 else "done",
        )
        for i, (name, led, detail) in enumerate(profile["treatments"])
    ]

    reports = [
        Report(
            id=f"lab{i+1}",
            title=title,
            date=_ago(rng.randint(5, 70)),
            value=value,
            unit=unit,
            ordered_by=rng.choice(["doctor_a", "doctor_b", "doctor_c", "doctor_d"]),
            note="Shared with the full care team",
        )
        for i, (title, value, unit) in enumerate(profile["labs"])
    ]

    notes = [
        Note(
            id="n1",
            author_id="doctor_a",
            author_label="Doctor A",
            date=_ago(12),
            text=(
                f"Primary care visit. Active problems reviewed with the shared list. "
                f"Care team includes Doctors A–D so specialists already see background history."
            ),
        ),
        Note(
            id="n2",
            author_id="doctor_b" if profile["focus"] != "heart" else "doctor_c",
            author_label="Doctor B" if profile["focus"] != "heart" else "Doctor C",
            date=_ago(20),
            text=(
                "Specialist follow-up. Treatment plan updated in the common space. "
                "No need for the patient to re-explain past conditions — they are already on the chart."
            ),
        ),
    ]

    return Patient(
        id=f"patient_{index}",
        label=f"Patient {index}",
        display_name=f"Patient {index}",
        age=rng.randint(48, 72),
        conditions=conditions,
        prescriptions=prescriptions,
        treatments=treatments,
        reports=reports,
        notes=notes,
        team=team,
    )
