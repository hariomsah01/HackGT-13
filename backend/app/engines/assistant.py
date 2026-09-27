"""Ava, the ClearPath voice assistant.

Patient mode: a short spoken intake that is summarized and sent to the care team or one doctor.
Doctor mode: the doctor talks through what the patient should know; Ava keeps a
patient-friendly draft the doctor can send.

Replies come from OpenAI (fast enough for back-and-forth voice), then Muse Spark, then a
scripted fallback. Speech-to-text stays on Muse Voice and text-to-speech on ElevenLabs.
"""
from __future__ import annotations

import json
import logging
from typing import Any, Literal, Optional

from app.config import get_settings
from app.engines.muse import MuseClient
from app.models.schemas import Patient

logger = logging.getLogger(__name__)

Mode = Literal["patient", "doctor"]
ASSISTANT_NAME = "Ava"
EMERGENCY_WORDS = (
    "chest pain",
    "can't breathe",
    "cannot breathe",
    "trouble breathing",
    "short of breath",
    "stroke",
    "face drooping",
    "slurred",
    "severe bleeding",
    "suicid",
    "kill myself",
    "passed out",
    "unconscious",
)


def _chart_context(patient: Patient) -> str:
    conditions = ", ".join(c.name for c in patient.conditions) or "none listed"
    meds = ", ".join(
        f"{rx.name} {rx.dose}".strip() for rx in patient.prescriptions if rx.status == "active"
    ) or "none listed"
    team = ", ".join(f"{m.label} ({m.specialty or m.role})" for m in patient.team)
    return f"Conditions: {conditions}. Active medicines: {meds}. Care team: {team}."


class CareAssistant:
    def __init__(self, muse: MuseClient) -> None:
        self.muse = muse
        self.settings = get_settings()
        self._openai = None
        if self.settings.openai_enabled:
            try:
                from openai import OpenAI

                self._openai = OpenAI(api_key=self.settings.openai_api_key, timeout=20.0)
            except Exception as exc:  # noqa: BLE001
                logger.warning("OpenAI init failed for assistant: %s", exc)

    @property
    def engine(self) -> str:
        if self._openai:
            return "openai"
        return "muse_spark" if self.muse.enabled else "scripted"

    # ── conversation ────────────────────────────────────────────

    def greeting(self, mode: Mode, patient: Patient, viewer_label: str, recipient_label: str) -> dict:
        if mode == "doctor":
            reply = (
                f"Hi {viewer_label}, it's {ASSISTANT_NAME}. Tell me what you'd like "
                f"{patient.label} to know, and I'll write it up for them in plain language."
            )
        else:
            reply = (
                f"Hi {patient.label}, I'm {ASSISTANT_NAME}, your ClearPath care assistant. "
                f"I'll pass what you tell me to {recipient_label}. What's going on today?"
            )
        return {"reply": reply, "ready": False, "urgent": False, "draft": ""}

    def turn(
        self,
        mode: Mode,
        patient: Patient,
        history: list[dict],
        user_text: str,
        viewer_label: str,
        recipient_label: str,
        draft: str = "",
        fda_reference: str = "",
    ) -> dict:
        urgent_hint = mode == "patient" and any(w in user_text.lower() for w in EMERGENCY_WORDS)
        system = self._system_prompt(mode, patient, viewer_label, recipient_label, draft)
        if fda_reference:
            system += " " + self._fda_instructions(mode) + f" FDA label reference: {fda_reference}"
        messages: list[dict[str, str]] = [{"role": "system", "content": system}]
        for t in history[-16:]:
            role = "assistant" if t.get("role") == "assistant" else "user"
            text = str(t.get("text") or "").strip()
            if text:
                messages.append({"role": role, "content": text})
        messages.append({"role": "user", "content": user_text})

        parsed = self._complete_json(messages)
        if not parsed:
            parsed = self._scripted(mode, patient, history, user_text, recipient_label, draft)

        reply = str(parsed.get("reply") or "").strip() or "Sorry, could you say that again?"
        out = {
            "reply": reply,
            "ready": bool(parsed.get("ready")),
            "urgent": bool(parsed.get("urgent")) or urgent_hint,
            "draft": str(parsed.get("draft") or draft or "").strip() if mode == "doctor" else "",
        }
        if out["urgent"] and "911" not in reply:
            out["reply"] = (
                "That could be an emergency. Please call 911 or go to the nearest emergency room now. "
                + reply
            )
        return out

    def summarize(self, patient: Patient, transcript: str, recipient_label: str) -> dict:
        system = (
            "You summarize a voice conversation between the ClearPath care assistant Ava and a "
            "patient, for the patient's doctors. Do not invent facts beyond the transcript. "
            "Output JSON only with keys: topic (3-6 words), insight (1-2 sentences for the doctor "
            "saying what the patient needs and that they need to hear back), urgency "
            "('routine' | 'soon' | 'urgent'), needs_callback (bool)."
        )
        user = f"Patient: {patient.label}. Sent to: {recipient_label}.\n\nTranscript:\n{transcript}"
        parsed = self._complete_json(
            [{"role": "system", "content": system}, {"role": "user", "content": user}]
        )
        if not parsed:
            low = transcript.lower()
            topic = "Patient check-in"
            if "appointment" in low or "checkup" in low or "check-up" in low or "schedule" in low:
                topic = "Appointment request"
            elif any(w in low for w in ("pain", "dizzy", "tired", "sick", "fever", "sugar", "pressure")):
                topic = "Symptoms update"
            elif any(w in low for w in ("pill", "medicine", "dose", "refill")):
                topic = "Medicine question"
            parsed = {
                "topic": topic,
                "insight": f"{patient.label} talked with Ava about {topic.lower()} and needs to hear from you.",
                "urgency": "urgent" if any(w in low for w in EMERGENCY_WORDS) else "routine",
                "needs_callback": True,
            }
        urgency = str(parsed.get("urgency") or "routine").lower()
        return {
            "topic": str(parsed.get("topic") or "Patient check-in"),
            "insight": str(parsed.get("insight") or f"{patient.label} needs to hear from you."),
            "urgency": urgency if urgency in ("routine", "soon", "urgent") else "routine",
            "needs_callback": bool(parsed.get("needs_callback", True)),
        }

    # ── internals ───────────────────────────────────────────────

    @staticmethod
    def _fda_instructions(mode: Mode) -> str:
        if mode == "doctor":
            return (
                "If the doctor asks about a medicine, answer briefly from the FDA label reference "
                "below, and when useful add the key patient-facing points (common side effects, what "
                "to watch for) to the draft in plain language."
            )
        return (
            "The patient is asking about one of their medicines. Answer their question directly "
            "from the FDA label reference below in plain, everyday words (no Latin or clinical "
            "jargon, 1-3 short sentences), and say it comes from the FDA label. Mention the most "
            "common side effects, and any serious warning signs that mean they should call their "
            "doctor. Never tell them to start, stop, skip or change a dose; say their doctor "
            "decides that. Then ask if they'd like you to pass the question on to their care "
            "team. Reports to the FDA do not prove a medicine caused a reaction. Do not set ready "
            "to true just because you answered a medicine question."
        )

    def _system_prompt(
        self, mode: Mode, patient: Patient, viewer_label: str, recipient_label: str, draft: str
    ) -> str:
        ctx = _chart_context(patient)
        if mode == "doctor":
            return (
                f"You are {ASSISTANT_NAME}, a warm, efficient female clinical assistant helping "
                f"{viewer_label} prepare a message for their patient {patient.label}. The doctor is "
                "talking to you by voice. Keep a patient-friendly draft written in the doctor's own "
                "voice (first person, plain language, 2-5 short sentences, no jargon, no markdown), "
                "and update it with everything the doctor says. Ask at most one short clarifying "
                "question when something important is missing (dose, timing, follow-up). "
                "Output JSON only: {\"reply\": what you say back to the doctor in 1-2 short spoken "
                "sentences, \"draft\": the full updated message to the patient, \"ready\": true when "
                "the draft is complete enough to send}. "
                f"Current draft: {draft or '(empty)'}. Chart: {ctx}"
            )
        return (
            f"You are {ASSISTANT_NAME}, a warm, calm British female care assistant at ClearPath, talking by "
            f"voice with {patient.label}. Use natural, gentle British phrasing. What they tell you will be sent to {recipient_label}. "
            "In a few short turns, learn why they are reaching out: symptoms (what, since when, how "
            "bad), medicine questions, or appointment requests (preferred days and times). Ask one "
            "question at a time. Speak in 1-2 short, friendly sentences, no lists or markdown. Never "
            "diagnose or change medicines. If they describe emergency signs (chest pain, trouble "
            "breathing, stroke signs, severe bleeding, thoughts of self-harm), tell them to call 911 "
            "now and set urgent to true. When you have enough (usually 3-5 exchanges) or they say "
            f"that's all, recap in one sentence and tell them to tap Send to share it with "
            f"{recipient_label}; set ready to true. "
            "Output JSON only: {\"reply\": string, \"ready\": bool, \"urgent\": bool}. "
            f"Chart: {ctx}"
        )

    def _complete_json(self, messages: list[dict[str, str]]) -> Optional[dict]:
        if self._openai:
            try:
                resp = self._openai.chat.completions.create(
                    model=self.settings.openai_model,
                    messages=messages,
                    temperature=0.5,
                    max_tokens=400,
                    response_format={"type": "json_object"},
                )
                return json.loads(resp.choices[0].message.content or "{}")
            except Exception as exc:  # noqa: BLE001
                logger.warning("Assistant OpenAI failed: %s", exc)
        if self.muse.enabled:
            data = self.muse.chat(messages, temperature=0.5)
            try:
                text = data["choices"][0]["message"]["content"] or ""
                start, end = text.find("{"), text.rfind("}") + 1
                if start >= 0 and end > start:
                    return json.loads(text[start:end])
            except Exception:  # noqa: BLE001
                return None
        return None

    def _scripted(
        self,
        mode: Mode,
        patient: Patient,
        history: list[dict],
        user_text: str,
        recipient_label: str,
        draft: str,
    ) -> dict[str, Any]:
        if mode == "doctor":
            new_draft = (draft + " " + user_text).strip() if draft else user_text.strip()
            return {
                "reply": "Got it, I've added that to the message. Anything else they should know?",
                "draft": new_draft,
                "ready": True,
            }
        user_turns = sum(1 for t in history if t.get("role") == "user") + 1
        prompts = [
            "Thanks for telling me. How long has this been going on, and how bad is it?",
            "Understood. Would you like an appointment, and which days and times work best?",
            f"Thank you, I have what I need. Tap Send to share this with {recipient_label}.",
        ]
        idx = min(user_turns - 1, len(prompts) - 1)
        return {"reply": prompts[idx], "ready": idx == len(prompts) - 1, "urgent": False}
