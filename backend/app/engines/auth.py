"""Doctor A–D and Patient 1–3 logins for the shared care space."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import time
from typing import Optional

from pydantic import BaseModel

USERS = [
    {
        "id": "patient_1_user",
        "label": "Patient 1",
        "kind": "patient",
        "role": "Patient",
        "specialty": "My care",
        "pin": "1001",
        "color": "#334155",
        "chart_id": "patient_1",
    },
    {
        "id": "patient_2_user",
        "label": "Patient 2",
        "kind": "patient",
        "role": "Patient",
        "specialty": "My care",
        "pin": "1002",
        "color": "#475569",
        "chart_id": "patient_2",
    },
    {
        "id": "patient_3_user",
        "label": "Patient 3",
        "kind": "patient",
        "role": "Patient",
        "specialty": "My care",
        "pin": "1003",
        "color": "#1e293b",
        "chart_id": "patient_3",
    },
    {
        "id": "doctor_a",
        "label": "Doctor A",
        "kind": "doctor",
        "role": "Primary care",
        "specialty": "Family medicine",
        "pin": "1111",
        "color": "#0F766E",
        "chart_id": None,
    },
    {
        "id": "doctor_b",
        "label": "Doctor B",
        "kind": "doctor",
        "role": "Specialist",
        "specialty": "Endocrinology",
        "pin": "2222",
        "color": "#1D4ED8",
        "chart_id": None,
    },
    {
        "id": "doctor_c",
        "label": "Doctor C",
        "kind": "doctor",
        "role": "Specialist",
        "specialty": "Cardiology",
        "pin": "3333",
        "color": "#B45309",
        "chart_id": None,
    },
    {
        "id": "doctor_d",
        "label": "Doctor D",
        "kind": "doctor",
        "role": "Specialist",
        "specialty": "Nephrology",
        "pin": "4444",
        "color": "#7C3AED",
        "chart_id": None,
    },
]

SECRET = b"clearpath-care-space-demo"


class SessionUser(BaseModel):
    id: str
    label: str
    kind: str
    role: str
    specialty: str
    color: str
    chart_id: Optional[str] = None


def list_users_public() -> list[dict]:
    return [
        {
            "id": u["id"],
            "label": u["label"],
            "kind": u["kind"],
            "role": u["role"],
            "specialty": u["specialty"],
            "color": u["color"],
            "chart_id": u.get("chart_id"),
        }
        for u in USERS
    ]


def doctor_team() -> list[dict]:
    return [
        {
            "id": u["id"],
            "label": u["label"],
            "role": u["role"],
            "specialty": u["specialty"],
        }
        for u in USERS
        if u["kind"] == "doctor"
    ]


def _to_session(row: dict) -> SessionUser:
    return SessionUser(
        id=row["id"],
        label=row["label"],
        kind=row["kind"],
        role=row["role"],
        specialty=row["specialty"],
        color=row["color"],
        chart_id=row.get("chart_id"),
    )


def assert_chart_access(user: SessionUser, patient_id: str) -> None:
    """Patients may only open their own chart."""
    if user.kind == "patient" and user.chart_id and user.chart_id != patient_id:
        raise PermissionError("You can only view your own chart")


def authenticate(user_id: str, pin: str) -> Optional[tuple[SessionUser, str]]:
    row = next((u for u in USERS if u["id"] == user_id), None)
    if not row or row["pin"] != pin:
        return None
    user = _to_session(row)
    return user, _mint(user)


def _mint(user: SessionUser) -> str:
    payload = {"sub": user.id, "exp": int(time.time()) + 60 * 60 * 14}
    body = json.dumps(payload, separators=(",", ":"))
    sig = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()[:24]
    return base64.urlsafe_b64encode(body.encode()).decode().rstrip("=") + "." + sig


def verify_token(token: str) -> Optional[SessionUser]:
    try:
        raw, sig = token.rsplit(".", 1)
        pad = "=" * (-len(raw) % 4)
        body = base64.urlsafe_b64decode(raw + pad).decode()
        expect = hmac.new(SECRET, body.encode(), hashlib.sha256).hexdigest()[:24]
        if not hmac.compare_digest(expect, sig):
            return None
        payload = json.loads(body)
        if payload.get("exp", 0) < time.time():
            return None
        row = next((u for u in USERS if u["id"] == payload["sub"]), None)
        if not row:
            return None
        return _to_session(row)
    except Exception:  # noqa: BLE001
        return None
