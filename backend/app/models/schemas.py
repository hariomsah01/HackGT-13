"""ClearPath schemas — shared care space (Meta track)."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class Condition(BaseModel):
    id: str
    name: str
    since: str
    status: str = "active"
    note: str = ""


class Prescription(BaseModel):
    id: str
    name: str
    dose: str
    status: Literal["active", "stopped"] = "active"
    started: str
    stopped: Optional[str] = None
    prescribed_by: str  # doctor id
    reason: str = ""


class Treatment(BaseModel):
    id: str
    name: str
    status: Literal["planned", "active", "done"] = "active"
    started: str
    led_by: str
    detail: str = ""


class Report(BaseModel):
    id: str
    title: str
    date: str
    value: str
    unit: str = ""
    note: str = ""
    ordered_by: str = ""


class Note(BaseModel):
    id: str
    author_id: str
    author_label: str
    date: str
    text: str


class CareMember(BaseModel):
    id: str
    label: str  # Doctor A
    role: str
    specialty: str


class Patient(BaseModel):
    id: str  # patient_1
    label: str  # Patient 1
    display_name: str  # kept internal for notes; UI shows label
    age: int
    conditions: list[Condition] = Field(default_factory=list)
    prescriptions: list[Prescription] = Field(default_factory=list)
    treatments: list[Treatment] = Field(default_factory=list)
    reports: list[Report] = Field(default_factory=list)
    notes: list[Note] = Field(default_factory=list)
    team: list[CareMember] = Field(default_factory=list)
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class HuddleMessage(BaseModel):
    id: str
    author_id: str
    author_label: str
    text: str
    timestamp: str


class CareRoom(BaseModel):
    """Common space for one patient + their doctors."""

    id: str
    patient_id: str
    member_ids: list[str]
    messages: list[HuddleMessage] = Field(default_factory=list)
    focus: str = ""
    updated_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class ActivityEvent(BaseModel):
    id: str
    timestamp: str
    actor_id: str
    actor_label: str
    patient_id: Optional[str] = None
    kind: str
    detail: str


class LoginRequest(BaseModel):
    user_id: str
    pin: str


class MessageRequest(BaseModel):
    text: str


class NoteRequest(BaseModel):
    text: str


class AskRequest(BaseModel):
    question: str = "Summarize what my care team knows about me in plain language."
    patient_id: Optional[str] = None
    tab: Optional[str] = None
    screen: dict[str, Any] = Field(default_factory=dict)


class RxProposeRequest(BaseModel):
    """Doctor drafts a prescription for shared-chart safety analysis."""

    name: str
    dose: str
    frequency: str = ""
    reason: str = ""


class RxAddRequest(BaseModel):
    """Commit a prescription to the shared chart after analysis."""

    name: str
    dose: str
    frequency: str = ""
    reason: str = ""
    analysis_severity: Optional[str] = None
