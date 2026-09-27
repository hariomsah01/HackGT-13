"""ElevenLabs text-to-speech for the Ava care assistant voice."""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.config import get_settings

logger = logging.getLogger(__name__)

BASE = "https://api.elevenlabs.io/v1"


class ElevenLabsClient:
    def __init__(self) -> None:
        s = get_settings()
        self.api_key = (s.elevenlabs_api_key or "").strip()
        self.voice_id = s.elevenlabs_voice_id
        self.model = s.elevenlabs_model

    @property
    def enabled(self) -> bool:
        return bool(self.api_key)

    def speak(self, text: str) -> Optional[bytes]:
        """Return MP3 bytes, or None so the browser can fall back to its own voice."""
        if not self.enabled or not text.strip():
            return None
        try:
            with httpx.Client(timeout=30.0) as client:
                resp = client.post(
                    f"{BASE}/text-to-speech/{self.voice_id}",
                    params={"output_format": "mp3_44100_128"},
                    headers={"xi-api-key": self.api_key, "Accept": "audio/mpeg"},
                    json={
                        "text": text[:2500],
                        "model_id": self.model,
                        "voice_settings": {"stability": 0.45, "similarity_boost": 0.8, "style": 0.2},
                    },
                )
            if resp.status_code >= 400:
                logger.warning("ElevenLabs HTTP %s: %s", resp.status_code, resp.text[:300])
                return None
            return resp.content
        except Exception as exc:  # noqa: BLE001
            logger.warning("ElevenLabs failed: %s", exc)
            return None
