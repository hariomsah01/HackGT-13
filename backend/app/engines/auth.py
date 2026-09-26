"""Doctor A–D and Patient logins for the shared care space."""
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
        "id": "doctor_a",
        "label": "Doctor A",
        "kind": "doctor",
        "role": "Primary care",
        "specialty": "Family medicine",
        "pin": "1111",
        "color": "#0F766E",
    },
    {
        "id": "doctor_b",
        "label": "Doctor B",
        "kind": "doctor",
        "role": "Specialist",
        "specialty": "Endocrinology",
        "pin": "2222",
        "color": "#1D4ED8",
    },
    {
        "id": "doctor_c",
        "label": "Doctor C",
        "kind": "doctor",
        "role": "Specialist",
        "specialty": "Cardiology",
        "pin": "3333",
        "color": "#B45309",
    },
    {
        "id": "doctor_d",
        "label": "Doctor D",
        "kind": "doctor",
        "role": "Specialist",
        "specialty": "Nephrology",
        "pin": "4444",
        "color": "#7C3AED",
    },
    {
        "id": "patient_viewer",
        "label": "Patient",
        "kind": "patient",
        "role": "Patient",
        "specialty": "",
        "pin": "0000",
        "color": "#334155",
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


def list_users_public() -> list[dict]:
    return [
        {
            "id": u["id"],
            "label": u["label"],
            "kind": u["kind"],
            "role": u["role"],
            "specialty": u["specialty"],
            "color": u["color"],
            "pin_hint": u["pin"],
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


def authenticate(user_id: str, pin: str) -> Optional[tuple[SessionUser, str]]:
    row = next((u for u in USERS if u["id"] == user_id), None)
    if not row or row["pin"] != pin:
        return None
    user = SessionUser(
        id=row["id"],
        label=row["label"],
        kind=row["kind"],
        role=row["role"],
        specialty=row["specialty"],
        color=row["color"],
    )
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
        return SessionUser(
            id=row["id"],
            label=row["label"],
            kind=row["kind"],
            role=row["role"],
            specialty=row["specialty"],
            color=row["color"],
        )
    except Exception:  # noqa: BLE001
        return None
