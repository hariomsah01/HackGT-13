"""In-memory store for patients, rooms, tasks, briefings, presence, live fans."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from app.models.schemas import (
    ActivityEvent,
    CareRoom,
    DoctorNotification,
    HuddleMessage,
    OfficeCall,
    Patient,
)


class CareStore:
    def __init__(self) -> None:
        self.patients: dict[str, Patient] = {}
        self.rooms: dict[str, CareRoom] = {}
        self.activity: list[ActivityEvent] = []
        self.tasks: dict[str, list[dict[str, Any]]] = {}
        self.briefings: dict[str, dict[str, Any]] = {}
        self.presence: dict[str, dict[str, Any]] = {}  # patient_id -> {user_id: meta}
        self.office_calls: dict[str, list[OfficeCall]] = {}  # patient_id -> calls
        self.notifications: dict[str, list[DoctorNotification]] = {}  # doctor_id -> notes
        self._seq = 0

    def next_patient_index(self) -> int:
        self._seq += 1
        return self._seq

    def save_patient(self, patient: Patient) -> None:
        self.patients[patient.id] = patient
        if patient.id not in self.rooms:
            self.rooms[patient.id] = CareRoom(
                id=f"room_{patient.id}",
                patient_id=patient.id,
                member_ids=[m.id for m in patient.team],
                focus=f"Shared care for {patient.label}",
            )

    def get_patient(self, patient_id: str) -> Optional[Patient]:
        return self.patients.get(patient_id)

    def list_patients(self) -> list[Patient]:
        return list(self.patients.values())

    def get_room(self, patient_id: str) -> Optional[CareRoom]:
        return self.rooms.get(patient_id)

    def log(
        self,
        actor_id: str,
        actor_label: str,
        patient_id: Optional[str],
        kind: str,
        detail: str,
    ) -> ActivityEvent:
        ev = ActivityEvent(
            id=f"act_{uuid4().hex[:8]}",
            timestamp=datetime.utcnow().isoformat(),
            actor_id=actor_id,
            actor_label=actor_label,
            patient_id=patient_id,
            kind=kind,
            detail=detail,
        )
        self.activity.insert(0, ev)
        self.activity = self.activity[:100]
        return ev

    def activity_feed(self, patient_id: Optional[str] = None, limit: int = 40) -> list[ActivityEvent]:
        items = self.activity
        if patient_id:
            items = [a for a in items if a.patient_id == patient_id]
        return items[:limit]

    def post_message(
        self,
        patient_id: str,
        author_id: str,
        author_label: str,
        text: str,
        to_id: Optional[str] = None,
        to_label: Optional[str] = None,
    ) -> CareRoom:
        room = self.rooms.get(patient_id)
        if not room:
            raise ValueError("Care room not found")
        msg = HuddleMessage(
            id=f"msg_{uuid4().hex[:8]}",
            author_id=author_id,
            author_label=author_label,
            text=text,
            timestamp=datetime.utcnow().isoformat(),
            to_id=to_id,
            to_label=to_label,
        )
        room.messages.append(msg)
        room.updated_at = datetime.utcnow().isoformat()
        self.log(author_id, author_label, patient_id, "message", text[:80])
        return room

    def add_task(self, patient_id: str, task: dict[str, Any]) -> None:
        self.tasks.setdefault(patient_id, []).insert(0, task)

    def list_tasks(self, patient_id: str) -> list[dict[str, Any]]:
        return self.tasks.get(patient_id, [])

    def save_briefing(self, patient_id: str, briefing: dict[str, Any]) -> None:
        briefing = self._sanitize_briefing(patient_id, briefing)
        briefing["updated_at"] = datetime.utcnow().isoformat()
        self.briefings[patient_id] = briefing

    def get_briefing(self, patient_id: str) -> Optional[dict[str, Any]]:
        raw = self.briefings.get(patient_id)
        if not raw:
            return None
        cleaned = self._sanitize_briefing(patient_id, dict(raw))
        if cleaned != raw:
            self.briefings[patient_id] = cleaned
        return cleaned

    def _sanitize_briefing(self, patient_id: str, briefing: dict[str, Any]) -> dict[str, Any]:
        """Drop open-question UI copy and generic alignment slogans."""
        issue = str(briefing.get("issue") or "")
        if "aligned" in issue.lower() or "still needs from each" in issue.lower():
            patient = self.patients.get(patient_id)
            label = getattr(patient, "label", None) if patient else None
            issue = f"Care plan for {label or 'this patient'}"
        briefing["issue"] = issue
        briefing["open_question"] = ""
        for_patient = str(briefing.get("for_patient") or "")
        lowered = for_patient.lower()
        if (
            "re-explain" in lowered
            or "coordinating" in lowered
            or "aligned" in lowered
            or "still needs from each" in lowered
        ):
            for_patient = ""
        briefing["for_patient"] = for_patient
        return briefing

    def set_presence(self, patient_id: str, user_id: str, label: str, kind: str) -> list[dict]:
        room = self.presence.setdefault(patient_id, {})
        room[user_id] = {
            "id": user_id,
            "label": label,
            "kind": kind,
            "seen_at": datetime.utcnow().isoformat(),
        }
        return list(room.values())

    def clear_presence(self, patient_id: str, user_id: str) -> list[dict]:
        room = self.presence.get(patient_id, {})
        room.pop(user_id, None)
        return list(room.values())

    def get_presence(self, patient_id: str) -> list[dict]:
        return list(self.presence.get(patient_id, {}).values())

    def save_office_call(self, call: OfficeCall) -> OfficeCall:
        self.office_calls.setdefault(call.patient_id, []).insert(0, call)
        return call

    def list_office_calls(self, patient_id: str) -> list[OfficeCall]:
        return list(self.office_calls.get(patient_id, []))

    def get_office_call(self, call_id: str) -> Optional[OfficeCall]:
        for calls in self.office_calls.values():
            for c in calls:
                if c.id == call_id:
                    return c
        return None

    def add_notification(self, note: DoctorNotification) -> DoctorNotification:
        self.notifications.setdefault(note.doctor_id, []).insert(0, note)
        return note

    def list_notifications(self, doctor_id: str, unread_only: bool = False) -> list[DoctorNotification]:
        notes = self.notifications.get(doctor_id, [])
        if unread_only:
            return [n for n in notes if not n.read]
        return list(notes)

    def mark_notification_read(self, doctor_id: str, note_id: str) -> Optional[DoctorNotification]:
        for n in self.notifications.get(doctor_id, []):
            if n.id == note_id:
                n.read = True
                return n
        return None

    def mark_office_call_status(
        self, call_id: str, status: str
    ) -> Optional[OfficeCall]:
        call = self.get_office_call(call_id)
        if not call:
            return None
        call.status = status  # type: ignore[assignment]
        if status == "read" and not call.read_at:
            call.read_at = datetime.utcnow().isoformat()
        return call
