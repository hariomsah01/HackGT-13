"""ClearPath care-space orchestration + Muse agent."""
from __future__ import annotations

from datetime import datetime
from uuid import uuid4

from app.engines.auth import SessionUser
from app.engines.care_agent import CareAgent
from app.engines.care_signals import care_attention, handoff_pack
from app.engines.connection_intel import connection_report
from app.engines.gemini_copilot import ScreenAsk
from app.engines.graph import build_care_graph
from app.engines.muse import MuseClient
from app.engines.patient_generator import generate_patient
from app.engines.rx_analysis import RxAnalyzer
from app.models.schemas import Note, Patient, Prescription
from app.services.store import CareStore


class CareEngine:
    def __init__(self, store: CareStore):
        self.store = store
        self.muse = MuseClient()
        self.agent = CareAgent(store, self.muse)
        self.ask = ScreenAsk()
        self.rx = RxAnalyzer()
        if not store.list_patients():
            for i in range(1, 4):
                self.create_patient(seed=10 + i)

    def create_patient(self, seed: int | None = None) -> Patient:
        idx = self.store.next_patient_index()
        patient = generate_patient(idx, seed=seed)
        self.store.save_patient(patient)
        self.store.log(
            "system",
            "ClearPath",
            patient.id,
            "created",
            f"{patient.label} joined the shared care space with Doctors A–D",
        )
        return patient

    def open_patient(self, patient_id: str, user: SessionUser) -> dict:
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        self.store.log(
            user.id,
            user.label,
            patient_id,
            "viewed",
            f"{user.label} opened the shared chart",
        )
        presence = self.store.set_presence(
            patient_id, user.id, user.label, user.kind
        )
        room = self.store.get_room(patient_id)
        briefing = self.store.get_briefing(patient_id)
        handoff = handoff_pack(patient, self.store, briefing)
        return {
            "patient": patient.model_dump(),
            "room": room.model_dump() if room else None,
            "graph": build_care_graph(patient),
            "activity": [a.model_dump() for a in self.store.activity_feed(patient_id)],
            "snapshot": self._snapshot(patient),
            "connections": connection_report(patient, room),
            "briefing": briefing,
            "tasks": self.store.list_tasks(patient_id),
            "presence": presence,
            "attention": handoff["attention"],
            "handoff": handoff,
            "team_activity": handoff["team_activity"],
            "muse": {"enabled": self.muse.enabled},
            "openai_rx": {"enabled": self.rx.enabled},
        }

    def _snapshot(self, patient: Patient) -> dict:
        active_rx = [p for p in patient.prescriptions if p.status == "active"]
        room = self.store.get_room(patient.id)
        return {
            "conditions": len(patient.conditions),
            "active_prescriptions": len(active_rx),
            "treatments": len(patient.treatments),
            "reports": len(patient.reports),
            "team_size": len(patient.team),
            "messages": len(room.messages) if room else 0,
        }

    def analytics(self) -> dict:
        patients = self.store.list_patients()
        rows = []
        bond_sum = 0.0
        attention_counts = {"clear": 0, "handoff": 0, "review": 0, "caution": 0}
        for p in patients:
            snap = self._snapshot(p)
            conn = connection_report(p, self.store.get_room(p.id))
            bond_sum += conn["bond_score"]
            briefing = self.store.get_briefing(p.id)
            attn = care_attention(p, briefing)
            attention_counts[attn["level"]] = attention_counts.get(attn["level"], 0) + 1
            rows.append(
                {
                    "patient_id": p.id,
                    "label": p.label,
                    "age": p.age,
                    "bond_score": conn["bond_score"],
                    "attention": attn,
                    "presence": self.store.get_presence(p.id),
                    "open_question": (briefing or {}).get("open_question") or "",
                    **snap,
                }
            )
        handoffs = [
            handoff_pack(p, self.store, self.store.get_briefing(p.id))
            for p in patients
            if (self.store.get_briefing(p.id) or {}).get("open_question")
            or care_attention(p, self.store.get_briefing(p.id))["level"] != "clear"
        ]
        return {
            "updated_at": datetime.utcnow().isoformat(),
            "totals": {
                "patients": len(patients),
                "conditions": sum(r["conditions"] for r in rows),
                "active_prescriptions": sum(r["active_prescriptions"] for r in rows),
                "treatments": sum(r["treatments"] for r in rows),
                "team_links": sum(r["team_size"] for r in rows),
                "avg_bond": round(bond_sum / max(len(patients), 1), 1),
                "needs_attention": attention_counts.get("caution", 0)
                + attention_counts.get("review", 0),
            },
            "attention_counts": attention_counts,
            "patients": rows,
            "handoffs": handoffs[:12],
            "activity": [a.model_dump() for a in self.store.activity_feed(limit=25)],
            "muse_enabled": self.muse.enabled,
            "gemini_enabled": self.ask.enabled,
            "openai_rx_enabled": self.rx.enabled,
        }

    def list_patients_enriched(self) -> list[dict]:
        out = []
        for p in self.store.list_patients():
            briefing = self.store.get_briefing(p.id)
            attn = care_attention(p, briefing)
            presence = self.store.get_presence(p.id)
            out.append(
                {
                    "id": p.id,
                    "label": p.label,
                    "age": p.age,
                    "conditions": [c.name for c in p.conditions],
                    "active_prescriptions": len(
                        [x for x in p.prescriptions if x.status == "active"]
                    ),
                    "team": [m.label for m in p.team],
                    "attention": attn,
                    "presence": presence,
                    "viewing_now": [u.get("label") for u in presence],
                    "open_question": (briefing or {}).get("open_question") or "",
                    "owner": (briefing or {}).get("owner") or "",
                }
            )
        return out

    def analyze_prescription(
        self,
        patient_id: str,
        user: SessionUser,
        name: str,
        dose: str,
        frequency: str,
        reason: str,
    ) -> dict:
        if user.kind != "doctor":
            raise ValueError("Only doctors can analyze prescriptions")
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        result = self.rx.analyze(
            patient,
            name=name,
            dose=dose,
            frequency=frequency,
            reason=reason,
            proposing_doctor_id=user.id,
            proposing_doctor_label=user.label,
        )
        sev = result.get("severity", "review")
        self.store.log(
            user.id,
            user.label,
            patient_id,
            "rx_analyze",
            f"{user.label} analyzed proposed {name} ({sev})",
        )
        result["patient_id"] = patient_id
        return result

    def add_prescription(
        self,
        patient_id: str,
        user: SessionUser,
        name: str,
        dose: str,
        frequency: str,
        reason: str,
        analysis_severity: str | None = None,
    ) -> dict:
        if user.kind != "doctor":
            raise ValueError("Only doctors can add prescriptions")
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        dose_line = dose.strip()
        if frequency.strip():
            dose_line = f"{dose_line} · {frequency.strip()}"
        rx = Prescription(
            id=f"rx_{uuid4().hex[:8]}",
            name=name.strip(),
            dose=dose_line,
            started=datetime.utcnow().date().isoformat(),
            prescribed_by=user.id,
            reason=reason.strip() or "Added from shared chart",
        )
        patient.prescriptions.insert(0, rx)
        self.store.save_patient(patient)
        sev_bit = f" after {analysis_severity} review" if analysis_severity else ""
        self.store.log(
            user.id,
            user.label,
            patient_id,
            "rx_add",
            f"{user.label} added {rx.name} ({rx.dose}) to the shared chart{sev_bit}",
        )
        # Soft open question for the team when severity was elevated
        if analysis_severity in ("caution", "avoid", "review"):
            self.store.add_task(
                patient_id,
                {
                    "id": f"task_{uuid4().hex[:8]}",
                    "owner_id": user.id,
                    "owner_label": user.label,
                    "task": f"Confirm {rx.name} with the care team",
                    "why": f"New Rx added{sev_bit}",
                    "status": "open",
                    "created_at": datetime.utcnow().isoformat(),
                },
            )
        return {
            "patient": patient.model_dump(),
            "prescription": rx.model_dump(),
            "attention": care_attention(patient, self.store.get_briefing(patient_id)),
        }

    def add_note(self, patient_id: str, user: SessionUser, text: str) -> Patient:
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        if user.kind != "doctor":
            raise ValueError("Only doctors can add clinical notes")
        patient.notes.insert(
            0,
            Note(
                id=f"note_{uuid4().hex[:8]}",
                author_id=user.id,
                author_label=user.label,
                date=datetime.utcnow().date().isoformat(),
                text=text.strip(),
            ),
        )
        self.store.save_patient(patient)
        self.store.log(user.id, user.label, patient_id, "note", text[:80])
        return patient

    def post_message(self, patient_id: str, user: SessionUser, text: str):
        room = self.store.post_message(patient_id, user.id, user.label, text)
        # Auto-refresh team briefing via Muse agent
        briefing = self.agent.brief_room(patient_id)
        return {"room": room.model_dump(), "briefing": briefing}

    def brief(self, patient_id: str) -> dict:
        return self.agent.brief_room(patient_id)

    def patient_summary(self, patient_id: str, question: str | None = None) -> str:
        return self.agent.patient_plain(patient_id, question)

    def ask_screen(
        self,
        question: str,
        user: SessionUser,
        patient_id: str | None,
        tab: str | None,
        screen: dict | None,
    ) -> dict:
        """Gemini Ask over the whole care platform + current route/page context."""
        ctx = dict(screen or {})
        if tab:
            ctx["tab"] = tab
        ctx.setdefault("route", tab or ctx.get("route") or "")
        ctx["viewer"] = {"id": user.id, "label": user.label, "kind": user.kind}

        # Always attach platform-wide knowledge so Ask works on every page.
        patients = self.store.list_patients()
        analytics = self.analytics()
        ctx["platform"] = {
            "totals": analytics.get("totals"),
            "patients": analytics.get("patients"),
            "activity": analytics.get("activity"),
            "handoffs": analytics.get("handoffs"),
            "attention_counts": analytics.get("attention_counts"),
            "patient_count": len(patients),
            "patient_labels": [p.label for p in patients],
        }

        # If a patient is in focus (route or explicit id), deepen chart context.
        focus_id = patient_id
        if not focus_id:
            # Heuristic: match mentioned patient label in the question
            ql = (question or "").lower()
            for p in patients:
                if p.label.lower() in ql or p.id.lower() in ql:
                    focus_id = p.id
                    break

        if focus_id:
            patient = self.store.get_patient(focus_id)
            if patient:
                room = self.store.get_room(focus_id)
                ctx["focus_patient_id"] = focus_id
                ctx.setdefault("patient", patient.model_dump())
                ctx.setdefault(
                    "room_messages",
                    [m.model_dump() for m in (room.messages if room else [])[-12:]],
                )
                briefing = self.store.get_briefing(focus_id)
                if not briefing or not briefing.get("next_step"):
                    try:
                        briefing = self.agent.brief_room(focus_id)
                    except Exception:  # noqa: BLE001
                        briefing = briefing or {}
                ctx["briefing"] = briefing
                ctx.setdefault("tasks", self.store.list_tasks(focus_id))
                ctx.setdefault("connections", connection_report(patient, room))
                ctx.setdefault("presence", self.store.get_presence(focus_id))
                ctx.setdefault("snapshot", self._snapshot(patient))
                handoff = handoff_pack(patient, self.store, briefing)
                ctx["attention"] = handoff["attention"]
                ctx["handoff"] = handoff
                self.store.log(
                    user.id,
                    user.label,
                    focus_id,
                    "ask",
                    question[:80],
                )
        else:
            self.store.log(user.id, user.label, None, "ask", question[:80])

        result = self.ask.answer(question, ctx, viewer_label=user.label)
        result["gemini_enabled"] = self.ask.enabled
        return result

    def capture_visit(
        self, patient_id: str, doctor: SessionUser, wav_bytes: bytes | None, demo: bool = False
    ) -> dict:
        if demo or not wav_bytes:
            tr = self.muse.transcribe_wav(b"")  # demo path inside client when empty+no key
            # Force demo transcript when no bytes
            if not wav_bytes:
                transcript = (
                    "Patient reports morning glucose has been higher. Feeling more tired. "
                    f"{doctor.label} will share the log with Doctor B and ask Doctor D to confirm kidney labs."
                )
            else:
                transcript = tr.get("transcript") or ""
            meta = {"source": tr.get("source", "demo"), "audioDurationMs": tr.get("audioDurationMs")}
        else:
            tr = self.muse.transcribe_wav(wav_bytes)
            transcript = tr.get("transcript") or ""
            meta = {
                "source": tr.get("source"),
                "audioDurationMs": tr.get("audioDurationMs"),
                "error": tr.get("error"),
            }
        if not transcript:
            raise ValueError("Could not transcribe visit audio")
        structured = self.agent.structure_visit(patient_id, transcript, doctor)
        briefing = self.agent.brief_room(patient_id)
        return {
            "transcript": transcript,
            "transcription": meta,
            "structured": structured,
            "briefing": briefing,
        }
