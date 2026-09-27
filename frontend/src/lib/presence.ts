"use client";

import { useEffect, useState } from "react";
import { api } from "./api";
import { useAuth } from "./auth";
import type { LiveStatus } from "./types";

const PING_MS = 8000;

/** Heartbeats for the signed-in user and returns live status for the watched ids. */
export function useLiveStatus(watch: string[]): Record<string, LiveStatus> {
  const { token } = useAuth();
  const [statuses, setStatuses] = useState<Record<string, LiveStatus>>({});
  const key = watch.join(",");

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    const ids = key ? key.split(",") : [];
    const ping = () =>
      api
        .presencePing(ids, token)
        .then((r) => {
          if (!cancelled) setStatuses(r.statuses || {});
        })
        .catch(() => {});
    ping();
    const t = setInterval(ping, PING_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") ping();
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", ping);
    return () => {
      cancelled = true;
      clearInterval(t);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", ping);
    };
  }, [token, key]);

  return statuses;
}

export function lastSeenText(status?: LiveStatus): string {
  if (!status) return "Checking…";
  if (status.online) return "Online now";
  if (!status.last_seen) return "Offline";
  const seen = new Date(status.last_seen.endsWith("Z") ? status.last_seen : `${status.last_seen}Z`);
  const mins = Math.max(0, Math.round((Date.now() - seen.getTime()) / 60000));
  if (mins < 1) return "Last seen just now";
  if (mins < 60) return `Last seen ${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `Last seen ${hours} h ago`;
  return `Last seen ${seen.toLocaleDateString()}`;
}
