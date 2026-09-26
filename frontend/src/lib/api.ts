const API =
  process.env.NEXT_PUBLIC_API_URL ||
  (process.env.NODE_ENV === "production" ? "/api/backend" : "http://localhost:8000");

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
  postMessage: (
    id: string,
    text: string,
    token: string,
    to?: { to_id?: string | null; to_label?: string | null }
  ) =>
    req<{ room: import("./types").CareRoom; briefing: import("./types").Briefing }>(
      `/api/patients/${id}/messages`,
      {
        method: "POST",
        token,
        body: JSON.stringify({
          text,
          to_id: to?.to_id ?? null,
          to_label: to?.to_label ?? null,
        }),
      }
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
      call: import("./types").OfficeCall;
      transcript: string;
      structured: Record<string, unknown>;
      transcription: Record<string, unknown>;
      office_calls: import("./types").OfficeCall[];
    }>(`/api/patients/${id}/visit`, { method: "POST", token, body: fd });
  },
  officeCall: (
    id: string,
    body: { doctor_id: string; reason?: string; demo?: boolean; transcript?: string },
    token: string
  ) =>
    req<{
      call: import("./types").OfficeCall;
      notification: import("./types").DoctorNotification;
      transcript: string;
      structured: Record<string, unknown>;
      office_calls: import("./types").OfficeCall[];
    }>(`/api/patients/${id}/office-call`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  officeCallAudio: (
    id: string,
    body: { doctor_id: string; reason?: string },
    audio: Blob,
    token: string
  ) => {
    const fd = new FormData();
    fd.append("audio", audio, "office-call.wav");
    fd.append("doctor_id", body.doctor_id);
    fd.append("reason", body.reason || "");
    fd.append("demo", "false");
    return req<{
      call: import("./types").OfficeCall;
      notification: import("./types").DoctorNotification;
      transcript: string;
      transcription: { source?: string; audioDurationMs?: number; error?: string };
      structured: Record<string, unknown>;
      office_calls: import("./types").OfficeCall[];
    }>(`/api/patients/${id}/office-call`, { method: "POST", token, body: fd });
  },
  notifications: (token: string) =>
    req<{
      notifications: import("./types").DoctorNotification[];
      unread: number;
    }>("/api/notifications", { token }),
  readNotification: (noteId: string, token: string) =>
    req<{ notification: import("./types").DoctorNotification }>(
      `/api/notifications/${noteId}/read`,
      { method: "POST", token }
    ),
  markCallResponded: (callId: string, token: string) =>
    req<{ call: import("./types").OfficeCall | null }>(
      `/api/office-calls/${callId}/responded`,
      { method: "POST", token }
    ),
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
  handoffs: (token: string) =>
    req<{
      handoffs: import("./types").HandoffPack[];
      attention_counts: Record<string, number>;
      updated_at: string;
    }>("/api/handoffs", { token }),
  analyzeRx: (
    patientId: string,
    body: { name: string; dose: string; frequency: string; reason: string },
    token: string
  ) =>
    req<import("./types").RxAnalysis>(`/api/patients/${patientId}/rx/analyze`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  addRx: (
    patientId: string,
    body: {
      name: string;
      dose: string;
      frequency: string;
      reason: string;
      analysis_severity?: string;
    },
    token: string
  ) =>
    req<{
      patient: import("./types").Patient;
      prescription: import("./types").Prescription;
      attention: import("./types").Attention;
    }>(`/api/patients/${patientId}/rx`, {
      method: "POST",
      token,
      body: JSON.stringify(body),
    }),
  stopRx: (
    patientId: string,
    rxId: string,
    token: string,
    reason = "Course completed"
  ) =>
    req<{
      patient: import("./types").Patient;
      prescription: import("./types").Prescription;
      graph: import("./types").GraphPayload;
      snapshot: Record<string, number>;
      attention: import("./types").Attention;
      connections?: import("./types").Connections;
    }>(`/api/patients/${patientId}/rx/${rxId}/stop`, {
      method: "POST",
      token,
      body: JSON.stringify({ reason }),
    }),
  wsUrl: (patientId: string, token: string) => {
    const base = API.startsWith("/")
      ? `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host}${API}`
      : API.replace(/^http/, "ws");
    return `${base}/api/ws/${patientId}?token=${encodeURIComponent(token)}`;
  },
};
