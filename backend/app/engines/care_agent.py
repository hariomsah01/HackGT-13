"""Muse Spark care agent — tool-using coordinator for the shared room.

Tools expose ClearPath data/actions. Muse decides what to call.
UI never says "AI" — surfaces as Team briefing / Visit note.
"""
from __future__ import annotations

import json
import logging
from datetime import datetime
from typing import Any, Optional
from uuid import uuid4

from app.engines.auth import SessionUser
from app.engines.connection_intel import connection_report
from app.engines.muse import MuseClient
from app.models.schemas import Note, Patient
from app.services.store import CareStore

logger = logging.getLogger(__name__)

TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "get_chart_snapshot",
            "description": "Get conditions, active medicines, treatments, and care team for the patient.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_room_messages",
            "description": "Get recent messages from the shared team room.",
            "parameters": {
                "type": "object",
                "properties": {"limit": {"type": "integer"}},
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "get_connection_map",
            "description": "See how strongly each doctor is connected to this patient and who should huddle.",
            "parameters": {"type": "object", "properties": {}, "additionalProperties": False},
        },
    },
    {
        "type": "function",
        "function": {
            "name": "post_team_task",
            "description": "Create a clear next step for a specific doctor on the team.",
            "parameters": {
                "type": "object",
                "properties": {
                    "owner_id": {
                        "type": "string",
                        "description": "doctor_a | doctor_b | doctor_c | doctor_d",
                    },
                    "task": {"type": "string"},
                    "why": {"type": "string"},
                },
                "required": ["owner_id", "task"],
            },
        },
    },
]


class CareAgent:
    def __init__(self, store: CareStore, muse: Optional[MuseClient] = None):
        self.store = store
        self.muse = muse or MuseClient()

    def _run_tool(self, name: str, args: dict, patient: Patient) -> Any:
        room = self.store.get_room(patient.id)
        if name == "get_chart_snapshot":
            return {
                "label": patient.label,
                "age": patient.age,
                "conditions": [c.model_dump() for c in patient.conditions],
                "active_medicines": [
                    p.model_dump() for p in patient.prescriptions if p.status == "active"
                ],
                "treatments": [t.model_dump() for t in patient.treatments],
                "team": [m.model_dump() for m in patient.team],
            }
        if name == "get_room_messages":
            limit = int(args.get("limit") or 20)
            msgs = (room.messages if room else [])[-limit:]
            return [m.model_dump() for m in msgs]
        if name == "get_connection_map":
            return connection_report(patient, room)
        if name == "post_team_task":
            owner = args.get("owner_id", "doctor_a")
            owner_label = next(
                (m.label for m in patient.team if m.id == owner), owner
            )
            task = {
                "id": f"task_{uuid4().hex[:8]}",
                "owner_id": owner,
                "owner_label": owner_label,
                "task": args.get("task", ""),
                "why": args.get("why", ""),
                "status": "open",
                "created_at": datetime.utcnow().isoformat(),
            }
            self.store.add_task(patient.id, task)
            self.store.log(
                "system",
                "ClearPath",
                patient.id,
                "task",
                f"{owner_label}: {task['task'][:60]}",
            )
            return task
        return {"error": f"unknown tool {name}"}

    def brief_room(self, patient_id: str) -> dict[str, Any]:
        """Turn room chatter into a human briefing + optional tasks."""
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        room = self.store.get_room(patient_id)
        transcript = "\n".join(
            f"{m.author_label}: {m.text}" for m in (room.messages if room else [])[-15:]
        ) or "(no messages yet)"

        system = (
            "You coordinate a care team for one patient. Doctors A–D share one chart. "
            "Use tools to inspect the chart and room, then produce a short briefing. "
            "Never invent clinical facts. Never diagnose. "
            "Prefer posting at most one clear team task if something is unresolved."
        )
        user = (
            f"Patient id: {patient_id}. Recent room messages:\n{transcript}\n\n"
            "1) Call tools you need. 2) When done, reply with JSON only:\n"
            '{"issue":"...","open_question":"...","owner":"Doctor X","next_step":"...","for_patient":"..."}'
        )

        if not self.muse.enabled:
            return self._deterministic_brief(patient, room)

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ]

        # Agentic tool loop (max 4 rounds)
        for _ in range(4):
            data = self.muse.chat(messages, tools=TOOLS)
            try:
                msg = data["choices"][0]["message"]
            except Exception:  # noqa: BLE001
                break
            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                content = msg.get("content") or ""
                briefing = self._parse_briefing(content, patient)
                briefing["engine"] = "muse_spark"
                self.store.save_briefing(patient_id, briefing)
                return briefing

            messages.append(msg)
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                result = self._run_tool(name, args, patient)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.get("id", name),
                        "content": json.dumps(result),
                    }
                )

        return self._deterministic_brief(patient, room)

    def structure_visit(
        self, patient_id: str, transcript: str, doctor: SessionUser
    ) -> dict[str, Any]:
        """Turn a visit transcript into a shared note + patient-facing line."""
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")

        system = (
            "You turn a clinic visit transcript into a shared care note. "
            "Do not invent facts. Output JSON only with keys: "
            "title, team_note, patient_plain, who_to_notify (array of Doctor A/B/C/D labels)."
        )
        chart = (
            f"Conditions: {', '.join(c.name for c in patient.conditions)}. "
            f"Medicines: {', '.join(p.name for p in patient.prescriptions if p.status=='active')}."
        )
        user = f"Chart context: {chart}\n\nTranscript:\n{transcript}"

        parsed = None
        if self.muse.enabled:
            text = self.muse.complete_text(system, user)
            parsed = self._parse_json_block(text or "")

        if not parsed:
            parsed = {
                "title": "Visit note",
                "team_note": transcript[:500],
                "patient_plain": (
                    "Your care team saved notes from today's visit on your shared chart."
                ),
                "who_to_notify": ["Doctor A", "Doctor B"],
            }

        note = Note(
            id=f"note_{uuid4().hex[:8]}",
            author_id=doctor.id,
            author_label=doctor.label,
            date=datetime.utcnow().date().isoformat(),
            text=f"{parsed.get('title', 'Visit note')}: {parsed.get('team_note', transcript)[:600]}",
        )
        patient.notes.insert(0, note)
        self.store.save_patient(patient)
        self.store.log(
            doctor.id,
            doctor.label,
            patient_id,
            "visit",
            "Visit captured into the shared chart",
        )

        # Notify via room message
        notify = ", ".join(parsed.get("who_to_notify") or [])
        self.store.post_message(
            patient_id,
            "system",
            "ClearPath",
            f"Visit note added by {doctor.label}."
            + (f" Please review: {notify}." if notify else ""),
        )

        return {
            "note": note.model_dump(),
            "patient_plain": parsed.get("patient_plain"),
            "who_to_notify": parsed.get("who_to_notify", []),
            "engine": "muse_spark" if self.muse.enabled else "deterministic",
        }

    def patient_plain(self, patient_id: str, question: str | None = None) -> str:
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        conditions = ", ".join(c.name for c in patient.conditions)
        meds = ", ".join(
            f"{p.name} ({p.dose})" for p in patient.prescriptions if p.status == "active"
        )
        team = ", ".join(m.label for m in patient.team)
        fallback = (
            f"{patient.label} is cared for by {team}. "
            f"Known conditions: {conditions}. Current medicines: {meds}. "
            "Your doctors already share this list, so you do not need to repeat your full history."
        )
        if not self.muse.enabled:
            return fallback
        text = self.muse.complete_text(
            "Rewrite for a patient in warm plain language. No jargon. No mention of AI or models. 4-6 short sentences. Do not invent facts.",
            f"Question: {question or 'What does my care team already know?'}\n"
            f"Patient: {patient.label}, age {patient.age}\nConditions: {conditions}\nMedicines: {meds}\nTeam: {team}",
        )
        return text or fallback

    def _deterministic_brief(self, patient: Patient, room) -> dict[str, Any]:
        last = room.messages[-1].text if room and room.messages else ""
        owner = patient.team[1].label if len(patient.team) > 1 else "Doctor A"
        briefing = {
            "issue": f"Keep {patient.label}'s care team aligned on the shared chart",
            "open_question": last[:120] if last else "Anything the team still needs from each other?",
            "owner": owner,
            "next_step": f"{owner} reviews the latest notes and confirms the plan with Doctor A",
            "for_patient": "Your doctors are coordinating in one place — you should not need to re-explain your history.",
            "engine": "deterministic",
        }
        self.store.save_briefing(patient.id, briefing)
        return briefing

    def _parse_briefing(self, content: str, patient: Patient) -> dict[str, Any]:
        data = self._parse_json_block(content) or {}
        return {
            "issue": data.get("issue") or f"Team alignment for {patient.label}",
            "open_question": data.get("open_question") or "What still needs a human decision?",
            "owner": data.get("owner") or "Doctor A",
            "next_step": data.get("next_step") or "Review the shared chart together",
            "for_patient": data.get("for_patient")
            or "Your care team is talking so you do not have to repeat yourself.",
        }

    def _parse_json_block(self, text: str) -> Optional[dict]:
        if not text:
            return None
        try:
            start = text.find("{")
            end = text.rfind("}") + 1
            if start >= 0 and end > start:
                return json.loads(text[start:end])
        except Exception:  # noqa: BLE001
            return None
        return None
