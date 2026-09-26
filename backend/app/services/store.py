"""In-memory store for patients, rooms, tasks, briefings, presence, live fans."""
from __future__ import annotations

from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from app.models.schemas import ActivityEvent, CareRoom, HuddleMessage, Patient


class CareStore:
    def __init__(self) -> None:
        self.patients: dict[str, Patient] = {}
        self.rooms: dict[str, CareRoom] = {}
        self.activity: list[ActivityEvent] = []
        self.tasks: dict[str, list[dict[str, Any]]] = {}
        self.briefings: dict[str, dict[str, Any]] = {}
        self.presence: dict[str, dict[str, Any]] = {}  # patient_id -> {user_id: meta}
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
        briefing["updated_at"] = datetime.utcnow().isoformat()
        self.briefings[patient_id] = briefing

    def get_briefing(self, patient_id: str) -> Optional[dict[str, Any]]:
        return self.briefings.get(patient_id)

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
