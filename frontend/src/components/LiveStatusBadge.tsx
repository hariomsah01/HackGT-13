"use client";

import { lastSeenText } from "@/lib/presence";
import type { LiveStatus } from "@/lib/types";

export function LiveStatusBadge({
  status,
  dark = false,
}: {
  status?: LiveStatus;
  dark?: boolean;
}) {
  const online = !!status?.online;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
        online
          ? dark
            ? "bg-emerald-400/15 text-emerald-300"
            : "bg-emerald-50 text-emerald-700"
          : dark
            ? "bg-white/10 text-slate-300"
            : "bg-slate-100 text-slate-500"
      }`}
    >
      <span className="relative flex h-2 w-2">
        {online && (
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-60" />
        )}
        <span
          className={`relative inline-flex h-2 w-2 rounded-full ${
            online ? "bg-emerald-500" : "bg-slate-400"
          }`}
        />
      </span>
      {lastSeenText(status)}
    </span>
  );
}
