"""ClearPath care-space orchestration + Muse agent."""
from __future__ import annotations

import base64
from datetime import datetime
from uuid import uuid4

from app.engines import fda
from app.engines.assistant import CareAssistant
from app.engines.auth import USERS, SessionUser, assert_chart_access
from app.engines.care_agent import CareAgent
from app.engines.care_signals import care_attention, handoff_pack
from app.engines.connection_intel import connection_report
from app.engines.elevenlabs import ElevenLabsClient
from app.engines.gemini_copilot import ScreenAsk
from app.engines.graph import build_care_graph
from app.engines.muse import MuseClient
from app.engines.patient_generator import generate_patient, patient_facing_message
from app.engines.rx_analysis import RxAnalyzer
from app.models.schemas import DoctorNotification, Note, OfficeCall, Patient, Prescription
from app.services.store import CareStore


class CareEngine:
    def __init__(self, store: CareStore):
        self.store = store
        self.muse = MuseClient()
        self.agent = CareAgent(store, self.muse)
        self.ask = ScreenAsk()
        self.rx = RxAnalyzer()
        self.assistant = CareAssistant(self.muse)
        self.voice = ElevenLabsClient()
        if not store.list_patients():
            for i in range(1, 4):
                self.create_patient(seed=10 + i)

    def create_patient(self, seed: int | None = None) -> Patient:
        idx = self.store.next_patient_index()
        patient = generate_patient(idx, seed=seed)
        self.store.save_patient(patient)
        self.store.save_briefing(
            patient.id,
            {
                "issue": f"Care plan for {patient.label}",
                "open_question": "",
                "owner": patient.team[0].label if patient.team else "Doctor A",
                "next_step": "Review shared notes and confirm the plan.",
                "for_patient": "",
                "engine": "seed",
            },
        )
        # One patient-facing message (same pattern for every chart)
        if len(patient.team) >= 2:
            focus = "metabolic"
            names = " ".join(c.name.lower() for c in patient.conditions)
            if "heart" in names or "fibrillation" in names:
                focus = "heart"
            elif "lumbar" in names or "radiculopathy" in names:
                focus = "spine"
            self.store.post_message(
                patient.id,
                patient.team[1].id,
                patient.team[1].label,
                patient_facing_message(focus),
            )
        return patient

    def open_patient(self, patient_id: str, user: SessionUser) -> dict:
        assert_chart_access(user, patient_id)
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        # Chart opens stay private — presence only, no activity feed noise
        presence = self.store.set_presence(
            patient_id, user.id, user.label, user.kind
        )
        room = self.store.get_room(patient_id)
        briefing = self.store.get_briefing(patient_id)
        handoff = handoff_pack(patient, self.store, briefing)
        fda.warm([rx.name for rx in patient.prescriptions if rx.status == "active"])
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
            "office_calls": [
                c.model_dump() for c in self.store.list_office_calls(patient_id)
            ],
            "muse": {"enabled": self.muse.enabled},
            "assistant": {
                "name": "Ava",
                "tts": "elevenlabs" if self.voice.enabled else "browser",
                "brain": self.assistant.engine,
            },
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
            if care_attention(p, self.store.get_briefing(p.id))["level"] != "clear"
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

    def list_patients_enriched(self, user: SessionUser | None = None) -> list[dict]:
        patients = self.store.list_patients()
        if user and user.kind == "patient" and user.chart_id:
            patients = [p for p in patients if p.id == user.chart_id]
        out = []
        for p in patients:
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
        # Team follow-up when severity was elevated
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

    def stop_prescription(
        self,
        patient_id: str,
        user: SessionUser,
        rx_id: str,
        reason: str = "",
    ) -> dict:
        """Prescribing doctor can stop a medicine when the course is complete."""
        if user.kind != "doctor":
            raise ValueError("Only doctors can remove prescriptions")
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        rx = next((p for p in patient.prescriptions if p.id == rx_id), None)
        if not rx:
            raise ValueError("Medicine not found")
        if rx.prescribed_by != user.id:
            raise ValueError(
                "Only the doctor who prescribed this medicine can remove it"
            )
        if rx.status != "active":
            raise ValueError("This medicine is already stopped")
        rx.status = "stopped"
        rx.stopped = datetime.utcnow().date().isoformat()
        note = (reason or "").strip() or "Course completed"
        if note and note.lower() not in (rx.reason or "").lower():
            rx.reason = f"{rx.reason} · Stopped: {note}".strip(" ·") if rx.reason else note
        self.store.save_patient(patient)
        self.store.log(
            user.id,
            user.label,
            patient_id,
            "rx_stop",
            f"{user.label} stopped {rx.name} ({rx.dose}) — {note}",
        )
        return {
            "patient": patient.model_dump(),
            "prescription": rx.model_dump(),
            "graph": build_care_graph(patient),
            "snapshot": self._snapshot(patient),
            "attention": care_attention(patient, self.store.get_briefing(patient_id)),
            "connections": connection_report(patient, self.store.get_room(patient_id)),
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

    def post_message(
        self,
        patient_id: str,
        user: SessionUser,
        text: str,
        to_id: str | None = None,
        to_label: str | None = None,
    ):
        assert_chart_access(user, patient_id)
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")

        # Private thread = patient ↔ one doctor (not the whole care team)
        is_private = False
        if to_id:
            if to_id == patient.id:
                if user.kind != "doctor":
                    raise ValueError("Only doctors can send a private reply to the patient")
                to_label = patient.label
                is_private = True
            else:
                member = next((m for m in patient.team if m.id == to_id), None)
                if not member:
                    raise ValueError("Recipient is not on this care team")
                to_label = member.label
                # Patient → specific doctor is private; doctor → doctor stays team-visible
                is_private = user.kind == "patient"

        room = self.store.post_message(
            patient_id,
            user.id,
            user.label,
            text,
            to_id=to_id,
            to_label=to_label,
        )
        if is_private:
            briefing = self.store.get_briefing(patient_id) or {}
        else:
            briefing = self.agent.brief_room(patient_id)
        return {
            "room": room.model_dump(),
            "briefing": briefing,
            "private": is_private,
        }

    # Browsers throttle timers in background tabs to about once a minute.
    ONLINE_WINDOW_S = 75

    def presence_ping(self, user: SessionUser, watch: list[str]) -> dict:
        """Heartbeat for the caller; returns live status for the ids they are watching."""
        self.store.touch_user(user.id)
        allowed: set[str] | None = None
        if user.kind == "patient":
            patient = self.store.get_patient(user.chart_id or "")
            allowed = {m.id for m in patient.team} if patient else set()

        now = datetime.utcnow()
        statuses: dict[str, dict] = {}
        for key in watch[:20]:
            row = next(
                (u for u in USERS if u["id"] == key or (u.get("chart_id") and u["chart_id"] == key)),
                None,
            )
            if not row or (allowed is not None and row["id"] not in allowed):
                continue
            seen = self.store.last_seen.get(row["id"])
            online = False
            if seen and row["id"] not in self.store.offline:
                online = (now - datetime.fromisoformat(seen)).total_seconds() <= self.ONLINE_WINDOW_S
            statuses[key] = {
                "user_id": row["id"],
                "label": row["label"],
                "online": online,
                "last_seen": seen,
            }
        return {"statuses": statuses, "server_time": now.isoformat()}

    def presence_leave(self, user: SessionUser) -> None:
        self.store.mark_user_offline(user.id)

    def send_voice_message(
        self, patient_id: str, user: SessionUser, wav_bytes: bytes, duration_ms: int | None = None
    ) -> dict:
        """Doctor records a voice message for the patient; Muse Voice transcribes it."""
        assert_chart_access(user, patient_id)
        if user.kind != "doctor":
            raise PermissionError("Only doctors can send voice messages to the patient")
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        if not any(m.id == user.id for m in patient.team):
            raise PermissionError("You are not on this patient's care team")
        if not wav_bytes:
            raise ValueError("The recording was empty")

        transcript = ""
        meta: dict = {"source": "none"}
        if self.muse.enabled:
            tr = self.muse.transcribe_wav(wav_bytes)
            transcript = (tr.get("transcript") or "").strip()
            meta = {
                "source": tr.get("source"),
                "audioDurationMs": tr.get("audioDurationMs"),
                "error": tr.get("error"),
            }
            duration_ms = duration_ms or tr.get("audioDurationMs")

        audio_id = f"vm_{uuid4().hex[:10]}"
        self.store.save_voice_audio(audio_id, wav_bytes)
        room = self.store.post_message(
            patient_id,
            user.id,
            user.label,
            transcript or "Voice message",
            to_id=patient.id,
            to_label=patient.label,
            audio_id=audio_id,
            duration_ms=duration_ms,
        )
        return {
            "room": room.model_dump(),
            "message": room.messages[-1].model_dump(),
            "transcription": meta,
            "private": True,
        }

    def voice_audio(self, patient_id: str, user: SessionUser, audio_id: str) -> tuple[bytes, str]:
        assert_chart_access(user, patient_id)
        room = self.store.get_room(patient_id)
        msg = next((m for m in (room.messages if room else []) if m.audio_id == audio_id), None)
        if not msg:
            raise ValueError("Voice message not found")
        if user.kind == "doctor" and user.id != msg.author_id:
            raise PermissionError("This voice message is private to its sender and the patient")
        audio = self.store.get_voice_audio(audio_id)
        if audio is None:
            raise ValueError("This recording is no longer available")
        return audio

    # ── Ava voice assistant ─────────────────────────────────────

    def _assistant_access(self, patient_id: str, user: SessionUser, mode: str) -> Patient:
        assert_chart_access(user, patient_id)
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        if mode == "doctor":
            if user.kind != "doctor" or not any(m.id == user.id for m in patient.team):
                raise PermissionError("Only doctors on this care team can use Ava for this patient")
        elif user.kind != "patient":
            raise PermissionError("Only the patient can start this conversation")
        return patient

    def _recipient(self, patient: Patient, recipient: str) -> tuple[list[str], str]:
        if not recipient or recipient == "team":
            return [m.id for m in patient.team], "your full care team"
        member = next((m for m in patient.team if m.id == recipient), None)
        if not member:
            raise ValueError("Choose a doctor from this care team")
        return [member.id], member.label

    def assistant_turn(
        self,
        patient_id: str,
        user: SessionUser,
        mode: str,
        history: list[dict],
        text: str = "",
        wav_bytes: bytes | None = None,
        hint: str = "",
        recipient: str = "team",
        draft: str = "",
    ) -> dict:
        """One back-and-forth with Ava: Muse Voice hears, the assistant replies, ElevenLabs speaks."""
        patient = self._assistant_access(patient_id, user, mode)
        if mode == "doctor":
            recipient_label = patient.label
        else:
            _, recipient_label = self._recipient(patient, recipient)

        user_text, source, transcription_error = text.strip(), "typed", None
        if not user_text and wav_bytes:
            if self.muse.enabled:
                tr = self.muse.transcribe_wav(wav_bytes)
                user_text = (tr.get("transcript") or "").strip()
                source = "muse_voice"
                transcription_error = tr.get("error")
            if not user_text and hint.strip():
                user_text, source = hint.strip(), "browser_captions"

        active_meds = [(rx.name, rx.reason) for rx in patient.prescriptions if rx.status == "active"]
        fda_refs: list[dict] = []
        if not history and not user_text:
            result = self.assistant.greeting(mode, patient, user.label, recipient_label)
            source = "start"
            fda.warm([name for name, _ in active_meds])
        elif not user_text:
            raise ValueError(
                "Ava didn't catch that. Try speaking a little closer to the mic, or type instead."
            )
        else:
            reference, fda_refs = self._fda_reference(user_text, history, active_meds)
            result = self.assistant.turn(
                mode, patient, history, user_text, user.label, recipient_label, draft,
                fda_reference=reference,
            )

        audio = self.voice.speak(result["reply"])
        return {
            **result,
            "fda_refs": fda_refs,
            "user_text": user_text,
            "user_source": source,
            "transcription_error": transcription_error,
            "audio_b64": base64.b64encode(audio).decode() if audio else None,
            "audio_mime": "audio/mpeg" if audio else None,
            "tts": "elevenlabs" if audio else "browser",
            "engine": self.assistant.engine,
        }

    @staticmethod
    def _fda_reference(
        user_text: str, history: list[dict], medicines: list[tuple[str, str]]
    ) -> tuple[str, list[dict]]:
        """FDA label facts for the medicines this turn (or the one just before it) is about."""
        names = fda.mentioned_medicines([user_text], medicines)
        if not names:
            recent = [str(t.get("text") or "") for t in history[-2:] if t.get("role") == "user"]
            if recent and any(w in user_text.lower() for w in (" it", "that", "this", "them", "those")):
                names = fda.mentioned_medicines(recent, medicines)
        parts: list[str] = []
        refs: list[dict] = []
        for name in names:
            profile = fda.drug_profile(name)
            text = fda.ava_reference(profile)
            if not text:
                continue
            parts.append(text)
            refs.append(
                {
                    "name": name,
                    "generic_name": profile.get("generic_name") or name,
                    "label_url": profile.get("sources", {}).get("label") or "",
                }
            )
        return " || ".join(parts), refs

    def fda_drug(self, user: SessionUser, name: str, patient_id: str | None = None) -> dict:
        """openFDA profile for the medicine info card."""
        if not name.strip():
            raise ValueError("Medicine name is required")
        if patient_id:
            assert_chart_access(user, patient_id)
        return fda.drug_profile(name.strip())

    def assistant_submit(
        self, patient_id: str, user: SessionUser, turns: list[dict], recipient: str
    ) -> dict:
        """Patient finished talking with Ava: summarize and notify the chosen doctor(s)."""
        patient = self._assistant_access(patient_id, user, "patient")
        doctor_ids, recipient_label = self._recipient(patient, recipient)
        if not any(t.get("role") == "user" and str(t.get("text") or "").strip() for t in turns):
            raise ValueError("Say something to Ava before sending")

        transcript = "\n".join(
            f"{'Ava' if t.get('role') == 'assistant' else patient.label}: {str(t.get('text') or '').strip()}"
            for t in turns
            if str(t.get("text") or "").strip()
        )
        summary = self.assistant.summarize(patient, transcript, recipient_label)
        primary = next(m for m in patient.team if m.id == doctor_ids[0])
        call = OfficeCall(
            id=f"call_{uuid4().hex[:8]}",
            patient_id=patient.id,
            patient_label=patient.label,
            doctor_id=primary.id,
            doctor_label=primary.label if len(doctor_ids) == 1 else "Care team",
            reason=summary["topic"],
            transcript=transcript,
            insight=summary["insight"],
            topic=summary["topic"],
            needs_callback=summary["needs_callback"],
            assistant_label="Ava · ClearPath assistant",
            source="ava_voice",
            recipient_ids=doctor_ids,
            recipient_label=recipient_label,
            urgency=summary["urgency"],
        )
        self.store.save_office_call(call)
        prefix = "Urgent: " if summary["urgency"] == "urgent" else ""
        for did in doctor_ids:
            self.store.add_notification(
                DoctorNotification(
                    id=f"note_{uuid4().hex[:8]}",
                    doctor_id=did,
                    recipient_id=did,
                    kind="assistant_conversation",
                    title=f"{prefix}{patient.label} talked with Ava",
                    detail=summary["insight"],
                    patient_id=patient.id,
                    patient_label=patient.label,
                    call_id=call.id,
                )
            )
        self.store.log(
            user.id,
            user.label,
            patient.id,
            "office_call",
            f"{patient.label} talked with Ava · sent to {recipient_label}: {summary['topic']}",
        )
        room = self.store.post_message(
            patient.id,
            "assistant_ava",
            "Ava · care assistant",
            f"{patient.label} talked with me: {summary['insight']}",
            to_id=doctor_ids[0] if len(doctor_ids) == 1 else None,
            to_label=recipient_label if len(doctor_ids) == 1 else None,
        )
        return {
            "call": call.model_dump(),
            "summary": summary,
            "recipient_label": recipient_label,
            "room": room.model_dump(),
            "office_calls": [c.model_dump() for c in self.store.list_office_calls(patient.id)],
        }

    def assistant_send_to_patient(
        self, patient_id: str, user: SessionUser, message: str, include_voice: bool = True
    ) -> dict:
        """Doctor sends the message drafted with Ava to the patient's private chat."""
        patient = self._assistant_access(patient_id, user, "doctor")
        message = message.strip()
        if not message:
            raise ValueError("The message is empty")

        audio_id = None
        if include_voice:
            audio = self.voice.speak(message)
            if audio:
                audio_id = f"vm_{uuid4().hex[:10]}"
                self.store.save_voice_audio(audio_id, audio, "audio/mpeg")
        room = self.store.post_message(
            patient.id,
            user.id,
            user.label,
            message,
            to_id=patient.id,
            to_label=patient.label,
            audio_id=audio_id,
        )
        patient_user = next((u for u in USERS if u.get("chart_id") == patient.id), None)
        if patient_user:
            self.store.add_notification(
                DoctorNotification(
                    id=f"note_{uuid4().hex[:8]}",
                    doctor_id=user.id,
                    recipient_id=patient_user["id"],
                    kind="doctor_update",
                    title=f"{user.label} sent you a message",
                    detail=message[:160],
                    patient_id=patient.id,
                    patient_label=patient.label,
                )
            )
        return {
            "room": room.model_dump(),
            "message": room.messages[-1].model_dump(),
            "voiced": bool(audio_id),
        }

    def brief(self, patient_id: str) -> dict:
        return self.agent.brief_room(patient_id)

    def patient_summary(self, patient_id: str, question: str | None = None, user: SessionUser | None = None) -> str:
        if user:
            assert_chart_access(user, patient_id)
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
        """Deprecated path — prefer record_office_call."""
        return self.record_office_call(
            patient_id=patient_id,
            actor=doctor,
            doctor_id=doctor.id,
            reason="In-clinic follow-up",
            wav_bytes=wav_bytes,
            demo=demo or not wav_bytes,
        )

    def record_office_call(
        self,
        patient_id: str,
        actor: SessionUser,
        doctor_id: str,
        reason: str = "",
        wav_bytes: bytes | None = None,
        demo: bool = True,
        transcript_override: str | None = None,
    ) -> dict:
        """Patient (or demo) calls a doctor's office; health assistant intake → doctor alert."""
        assert_chart_access(actor, patient_id)
        patient = self.store.get_patient(patient_id)
        if not patient:
            raise ValueError("Patient not found")
        member = next((m for m in patient.team if m.id == doctor_id), None)
        if not member:
            raise ValueError("Doctor not on this care team")

        if transcript_override and transcript_override.strip():
            transcript = transcript_override.strip()
            meta = {"source": "typed", "audioDurationMs": 0}
        elif demo or not wav_bytes:
            patient_line = reason.strip() or (
                "I have been feeling more tired and my morning glucose looks higher. "
                "I also want to schedule a checkup when the doctor is free."
            )
            transcript = (
                f"Office assistant: Thank you for calling {member.label}'s office, "
                f"this is Sam. How can I help you today?\n"
                f"{patient.label}: {patient_line}\n"
                f"Office assistant: I will note that for {member.label} and ask them to "
                f"call you back about your symptoms and appointment. Is there anything else?\n"
                f"{patient.label}: That is all, thank you.\n"
                f"Office assistant: You are welcome. {member.label} will follow up with you."
            )
            meta = {"source": "demo", "audioDurationMs": 0}
        else:
            tr = self.muse.transcribe_wav(wav_bytes)
            transcript = tr.get("transcript") or ""
            meta = {
                "source": tr.get("source") or "muse_voice",
                "audioDurationMs": tr.get("audioDurationMs"),
                "error": tr.get("error"),
            }
        if not transcript:
            if meta.get("error"):
                raise ValueError(f"Muse Voice could not transcribe the call: {meta['error']}")
            raise ValueError(
                "Muse Voice heard no speech in the recording — speak for a few seconds and try again"
            )

        structured = self.agent.structure_office_call(
            patient_id, transcript, member.label, reason
        )
        call = OfficeCall(
            id=f"call_{uuid4().hex[:8]}",
            patient_id=patient.id,
            patient_label=patient.label,
            doctor_id=member.id,
            doctor_label=member.label,
            reason=reason.strip() or structured["topic"],
            transcript=transcript,
            insight=structured["insight"],
            topic=structured["topic"],
            needs_callback=structured["needs_callback"],
            status="new",
            assistant_label="Office assistant (Sam)",
            source=str(meta.get("source") or "demo"),
        )
        self.store.save_office_call(call)

        note = DoctorNotification(
            id=f"notif_{uuid4().hex[:8]}",
            doctor_id=member.id,
            kind="office_call",
            title=f"{patient.label} called your office",
            detail=call.insight,
            patient_id=patient.id,
            patient_label=patient.label,
            call_id=call.id,
            read=False,
        )
        self.store.add_notification(note)

        self.store.log(
            actor.id,
            actor.label,
            patient_id,
            "office_call",
            f"{patient.label} called {member.label}'s office — {call.topic}",
        )

        # Seed a private thread cue so the doctor can reply in Patient private
        self.store.post_message(
            patient_id,
            "system",
            "Office assistant",
            f"Call summary for {member.label}: {call.insight}",
            to_id=member.id,
            to_label=member.label,
        )

        return {
            "call": call.model_dump(),
            "notification": note.model_dump(),
            "transcript": transcript,
            "transcription": meta,
            "structured": structured,
            "office_calls": [c.model_dump() for c in self.store.list_office_calls(patient_id)],
        }

    def list_doctor_notifications(self, user: SessionUser) -> dict:
        notes = self.store.list_notifications(user.id)
        return {
            "notifications": [n.model_dump() for n in notes],
            "unread": sum(1 for n in notes if not n.read),
        }

    def mark_notification_read(self, user: SessionUser, note_id: str) -> dict:
        note = self.store.mark_notification_read(user.id, note_id)
        if not note:
            raise ValueError("Notification not found")
        if note.call_id and user.kind == "doctor":
            call = self.store.get_office_call(note.call_id)
            if call and call.status == "new":
                self.store.mark_office_call_status(note.call_id, "read")
        return {"notification": note.model_dump()}

    def mark_office_call_responded(self, user: SessionUser, call_id: str) -> dict:
        call = self.store.get_office_call(call_id)
        if not call:
            raise ValueError("Office call not found")
        if user.kind == "doctor" and user.id not in (call.recipient_ids or [call.doctor_id]):
            raise ValueError("This conversation was sent to another doctor")
        assert_chart_access(user, call.patient_id)
        updated = self.store.mark_office_call_status(call_id, "responded")
        return {"call": updated.model_dump() if updated else None}

