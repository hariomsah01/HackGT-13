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
    phone: str = ""
    email: str = ""
    address: str = ""
    city: str = ""
    state: str = "GA"
    zip: str = ""
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
    to_id: Optional[str] = None  # doctor id, or None for whole care team
    to_label: Optional[str] = None
    kind: Literal["text", "voice"] = "text"
    audio_id: Optional[str] = None
    duration_ms: Optional[int] = None


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
    to_id: Optional[str] = None
    to_label: Optional[str] = None


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


class RxStopRequest(BaseModel):
    """Prescribing doctor stops a medicine when the course is complete."""

    reason: str = "Course completed"


class OfficeCall(BaseModel):
    """Health-assistant phone intake when the doctor cannot take the call live."""

    id: str
    patient_id: str
    patient_label: str
    doctor_id: str
    doctor_label: str
    reason: str = ""
    transcript: str
    insight: str  # short message for the doctor
    topic: str = ""
    needs_callback: bool = True
    status: Literal["new", "read", "responded"] = "new"
    assistant_label: str = "Office assistant"
    source: str = "demo"
    recipient_ids: list[str] = Field(default_factory=list)  # every doctor it was sent to
    recipient_label: str = ""
    urgency: str = "routine"
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())
    read_at: Optional[str] = None


class DoctorNotification(BaseModel):
    id: str
    doctor_id: str  # the doctor it concerns (recipient for office calls, sender for updates)
    recipient_id: str = ""  # user who sees it; defaults to doctor_id
    kind: str  # office_call | assistant_conversation | doctor_update
    title: str
    detail: str
    patient_id: str
    patient_label: str
    call_id: Optional[str] = None
    read: bool = False
    created_at: str = Field(default_factory=lambda: datetime.utcnow().isoformat())


class OfficeCallRequest(BaseModel):
    doctor_id: str
    reason: str = ""
    demo: bool = True
    transcript: Optional[str] = None


class AssistantTurnText(BaseModel):
    role: Literal["assistant", "user"]
    text: str


class AssistantSubmitRequest(BaseModel):
    turns: list[AssistantTurnText]
    recipient: str = "team"  # "team" or a doctor id


class AssistantSendRequest(BaseModel):
    message: str
    include_voice: bool = True


class PresencePing(BaseModel):
    watch: list[str] = Field(default_factory=list)  # user ids or patient chart ids
