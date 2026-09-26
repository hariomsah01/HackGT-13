const API = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

async function req<T>(
  path: string,
  opts: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, ...init } = opts;
  const headers: Record<string, string> = {
    ...(init.headers as Record<string, string>),
  };
  if (!(init.body instanceof FormData)) {
    headers["Content-Type"] = "application/json";
  }
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`${API}${path}`, { ...init, headers });
  if (!res.ok) {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      throw new Error(typeof j.detail === "string" ? j.detail : text);
    } catch (e) {
      if (e instanceof Error && e.message !== text) throw e;
      throw new Error(text || res.statusText);
    }
  }
  return res.json();
}

export const api = {
  health: () => req<{ status: string; muse?: boolean }>("/api/health"),
  users: () => req<import("./types").PublicUser[]>("/api/auth/users"),
  login: (user_id: string, pin: string) =>
    req<{ token: string; user: import("./types").SessionUser }>("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ user_id, pin }),
    }),
  patients: (token: string) =>
    req<import("./types").PatientListItem[]>("/api/patients", { token }),
  createPatient: (token: string) =>
    req<import("./types").Patient>("/api/patients", { method: "POST", token }),
  openPatient: (id: string, token: string) =>
    req<import("./types").PatientBundle>(`/api/patients/${id}`, { token }),
  postMessage: (id: string, text: string, token: string) =>
    req<{ room: import("./types").CareRoom; briefing: import("./types").Briefing }>(
      `/api/patients/${id}/messages`,
      { method: "POST", token, body: JSON.stringify({ text }) }
    ),
  addNote: (id: string, text: string, token: string) =>
    req<import("./types").Patient>(`/api/patients/${id}/notes`, {
      method: "POST",
      token,
      body: JSON.stringify({ text }),
    }),
  brief: (id: string, token: string) =>
    req<import("./types").Briefing>(`/api/patients/${id}/brief`, {
      method: "POST",
      token,
    }),
  captureVisit: (id: string, token: string, file?: Blob) => {
    const fd = new FormData();
    if (file) fd.append("audio", file, "visit.wav");
    fd.append("demo", file ? "false" : "true");
    return req<{
      transcript: string;
      structured: Record<string, unknown>;
      briefing: import("./types").Briefing;
      transcription: Record<string, unknown>;
    }>(`/api/patients/${id}/visit`, { method: "POST", token, body: fd });
  },
  activity: (token: string, patientId?: string) =>
    req<import("./types").ActivityEvent[]>(
      patientId ? `/api/activity?patient_id=${patientId}` : "/api/activity",
      { token }
    ),
  analytics: (token: string) =>
    req<import("./types").Analytics>("/api/analytics", { token }),
  summary: (id: string, token: string, question?: string) =>
    req<{ text: string }>(`/api/patients/${id}/summary`, {
      method: "POST",
      token,
      body: JSON.stringify({ question: question || "" }),
    }),
  ask: (
    body: {
      question: string;
      patient_id?: string;
      tab?: string;
      screen?: Record<string, unknown>;
    },
    token: string
  ) =>
    req<{ answer: string; source: string; gemini?: boolean; gemini_enabled?: boolean }>(
      "/api/ask",
      { method: "POST", token, body: JSON.stringify(body) }
    ),
  wsUrl: (patientId: string, token: string) => {
    const base = API.replace(/^http/, "ws");
    return `${base}/api/ws/${patientId}?token=${encodeURIComponent(token)}`;
  },
};
