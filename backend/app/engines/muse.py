"""Meta Muse clients — Spark (agentic) + Voice Transcribe.

Uses Meta Model API: https://api.meta.ai/v1
Falls back gracefully when MODEL_API_KEY is unset (demo still works).
"""
from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

BASE = "https://api.meta.ai/v1"
SPARK_MODEL = "muse-spark-1.3"
VOICE_MODEL = "muse-voice-transcribe-1.0"


class MuseClient:
    def __init__(self) -> None:
        s = get_settings()
        self.api_key = (s.model_api_key or "").strip()
        self.spark_model = s.muse_spark_model or SPARK_MODEL
        self.voice_model = s.muse_voice_model or VOICE_MODEL

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def _headers(self) -> dict[str, str]:
        return {
            "Authorization": f"Bearer {self.api_key}",
            "Content-Type": "application/json",
        }

    def chat(
        self,
        messages: list[dict[str, Any]],
        tools: Optional[list[dict]] = None,
        temperature: float = 0.3,
    ) -> dict[str, Any]:
        """OpenAI-compatible chat completions against Muse Spark."""
        if not self.enabled:
            return {"choices": [{"message": {"role": "assistant", "content": None}}], "demo": True}

        payload: dict[str, Any] = {
            "model": self.spark_model,
            "messages": messages,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"

        try:
            with httpx.Client(timeout=60.0) as client:
                resp = client.post(
                    f"{BASE}/chat/completions",
                    headers=self._headers(),
                    json=payload,
                )
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:  # noqa: BLE001
            logger.warning("Muse Spark call failed: %s", exc)
            return {"error": str(exc), "choices": []}

    def complete_text(self, system: str, user: str) -> Optional[str]:
        data = self.chat(
            [
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ]
        )
        try:
            return data["choices"][0]["message"]["content"]
        except Exception:  # noqa: BLE001
            return None

    def transcribe_wav(self, wav_bytes: bytes) -> dict[str, Any]:
        """POST /asr/transcribe with Muse Voice Transcribe."""
        if not self.enabled:
            return {
                "transcript": (
                    "Patient reports feeling more tired this week. Blood sugar readings "
                    "have been higher in the mornings. Agreed to share glucose log with "
                    "Doctor B and confirm kidney labs with Doctor D before changing medicines."
                ),
                "audioDurationMs": 42000,
                "demo": True,
                "source": "demo_transcript",
            }

        try:
            with httpx.Client(timeout=120.0) as client:
                resp = client.post(
                    f"{BASE}/asr/transcribe",
                    headers={
                        "Authorization": f"Bearer {self.api_key}",
                        "Accept": "application/json",
                    },
                    files={
                        "request": (
                            None,
                            json.dumps(
                                {
                                    "model": self.voice_model,
                                    "audioEncoding": "WAV",
                                    "mode": "DIARIZATION",
                                }
                            ),
                            "application/json",
                        ),
                        "audio": ("visit.wav", wav_bytes, "audio/wav"),
                    },
                )
                resp.raise_for_status()
                data = resp.json()
                data["source"] = "muse_voice"
                return data
        except Exception as exc:  # noqa: BLE001
            logger.warning("Muse Voice failed: %s", exc)
            return {"error": str(exc), "transcript": "", "source": "error"}
