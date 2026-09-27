"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import type { RoomMessage } from "@/lib/types";

function clock(ms?: number | null) {
  if (!ms) return "";
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function VoiceMessage({ patientId, message }: { patientId: string; message: RoomMessage }) {
  const { token } = useAuth();
  const [src, setSrc] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hasTranscript = message.text && message.text !== "Voice message";

  useEffect(() => () => {
    if (src) URL.revokeObjectURL(src);
  }, [src]);

  async function load() {
    if (!token || !message.audio_id) return;
    setLoading(true);
    setError(null);
    try {
      const blob = await api.voiceAudio(patientId, message.audio_id, token);
      setSrc(URL.createObjectURL(blob));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load the recording");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-violet-100 px-2.5 py-1 text-xs font-semibold text-violet-700">
          Voice message{message.duration_ms ? ` · ${clock(message.duration_ms)}` : ""}
        </span>
        {src ? (
          <audio controls autoPlay src={src} className="h-9 max-w-full" />
        ) : (
          <button
            type="button"
            onClick={load}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-full bg-[var(--ink)] px-3.5 py-1.5 text-xs font-bold text-white disabled:opacity-50"
          >
            <svg width="10" height="12" viewBox="0 0 10 12" aria-hidden>
              <path d="M0 0l10 6-10 6z" fill="currentColor" />
            </svg>
            {loading ? "Loading…" : "Play"}
          </button>
        )}
      </div>
      {error && <p className="text-xs text-rose-600">{error}</p>}
      <p className="text-sm leading-relaxed text-[var(--muted)]">
        {hasTranscript ? (
          <>
            <span className="font-semibold text-slate-600">Transcript · Muse Voice: </span>
            {message.text}
          </>
        ) : (
          "No transcript for this recording."
        )}
      </p>
    </div>
  );
}
