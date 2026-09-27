export type UserKind = "doctor" | "patient";

export interface SessionUser {
  id: string;
  label: string;
  kind: UserKind;
  role: string;
  specialty: string;
  color: string;
  chart_id?: string | null;
}

export type PublicUser = SessionUser;

export interface Condition {
  id: string;
  name: string;
  since: string;
  status: string;
  note: string;
}

export interface Prescription {
  id: string;
  name: string;
  dose: string;
  status: "active" | "stopped";
  started: string;
  stopped?: string;
  prescribed_by: string;
  reason: string;
}

export interface Treatment {
  id: string;
  name: string;
  status: string;
  started: string;
  led_by: string;
  detail: string;
}

export interface Report {
  id: string;
  title: string;
  date: string;
  value: string;
  unit: string;
  note: string;
  ordered_by: string;
}

export interface Note {
  id: string;
  author_id: string;
  author_label: string;
  date: string;
  text: string;
}

export interface CareMember {
  id: string;
  label: string;
  role: string;
  specialty: string;
}

export interface Patient {
  id: string;
  label: string;
  display_name: string;
  age: number;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  conditions: Condition[];
  prescriptions: Prescription[];
  treatments: Treatment[];
  reports: Report[];
  notes: Note[];
  team: CareMember[];
  created_at: string;
}

export interface PatientListItem {
  id: string;
  label: string;
  age: number;
  conditions: string[];
  active_prescriptions: number;
  team: string[];
  attention?: Attention;
  presence?: PresenceUser[];
  viewing_now?: string[];
  open_question?: string;
  owner?: string;
}

export interface RoomMessage {
  id: string;
  author_id: string;
  author_label: string;
  text: string;
  timestamp: string;
  to_id?: string | null;
  to_label?: string | null;
  kind?: "text" | "voice";
  audio_id?: string | null;
  duration_ms?: number | null;
}

export interface LiveStatus {
  user_id: string;
  label: string;
  online: boolean;
  last_seen?: string | null;
}

export interface CareRoom {
  id: string;
  patient_id: string;
  member_ids: string[];
  messages: RoomMessage[];
  focus: string;
  updated_at: string;
}

export interface GraphPayload {
  nodes: {
    id: string;
    label: string;
    type: string;
    status: string;
    meta?: Record<string, string>;
  }[];
  edges: { id: string; source: string; target: string; label?: string }[];
}

export interface ActivityEvent {
  id: string;
  timestamp: string;
  actor_id: string;
  actor_label: string;
  patient_id: string;
  kind: string;
  detail: string;
}

export interface Briefing {
  issue: string;
  open_question: string;
  owner: string;
  next_step: string;
  for_patient: string;
  engine?: string;
  updated_at?: string;
}

export interface TeamTask {
  id: string;
  owner_id: string;
  owner_label: string;
  task: string;
  why: string;
  status: string;
  created_at: string;
}

export interface ConnectionMember {
  id: string;
  label: string;
  specialty: string;
  role: string;
  connection_score: number;
  closeness: string;
  reasons: string[];
}

export interface Connections {
  team_connection: ConnectionMember[];
  bridges: { type: string; doctors: string[]; why: string }[];
  suggest_next_huddle: string[];
  bond_score: number;
  headline: string;
}

export interface PresenceUser {
  id: string;
  label: string;
  kind: string;
  seen_at: string;
}

export interface AttentionFlag {
  level: string;
  code: string;
  title: string;
  detail: string;
  patient_title?: string;
  patient_detail?: string;
}

export interface Attention {
  level: "clear" | "handoff" | "review" | "caution" | string;
  badge: string;
  flags: AttentionFlag[];
  multi_doctor_rx?: boolean;
  active_prescriptions?: number;
  prescriber_count?: number;
}

export interface TeamActivity {
  id: string;
  label: string;
  kind: string;
  detail: string;
  at?: string;
  viewing_now?: boolean;
  seen_at?: string;
}

export interface HandoffPack {
  patient_id: string;
  patient_label: string;
  open_question: string;
  owner: string;
  next_step: string;
  issue: string;
  for_patient: string;
  tasks: TeamTask[];
  attention: Attention;
  team_activity: TeamActivity[];
  updated_at?: string;
}

export interface RxFinding {
  severity: string;
  kind: string;
  title: string;
  detail: string;
  affects_other_doctors?: boolean;
  related_doctors?: string[];
}

export interface RxAnalysis {
  severity: string;
  summary: string;
  recommendation: string;
  findings: RxFinding[];
  impacts_other_regimens: boolean;
  proposed: {
    name: string;
    dose: string;
    frequency: string;
    reason: string;
    proposed_by: string;
  };
  engine?: string;
  openai?: boolean;
  online?: boolean;
  online_sources?: string[];
  patient_id?: string;
  error?: string;
}

export interface OfficeCall {
  id: string;
  patient_id: string;
  patient_label: string;
  doctor_id: string;
  doctor_label: string;
  reason: string;
  transcript: string;
  insight: string;
  topic: string;
  needs_callback: boolean;
  status: "new" | "read" | "responded";
  assistant_label: string;
  source: string;
  recipient_ids?: string[];
  recipient_label?: string;
  urgency?: "routine" | "soon" | "urgent" | string;
  created_at: string;
  read_at?: string | null;
}

export interface AssistantTurnResult {
  reply: string;
  ready: boolean;
  urgent: boolean;
  draft: string;
  user_text: string;
  user_source: "typed" | "muse_voice" | "browser_captions" | "start";
  transcription_error?: string | null;
  audio_b64?: string | null;
  audio_mime?: string | null;
  tts: "elevenlabs" | "browser";
  engine: string;
  fda_refs?: FdaRef[];
}

export interface FdaRef {
  name: string;
  generic_name: string;
  label_url: string;
}

export interface FdaProduct {
  brand: string;
  labeler: string;
  form: string;
  strength: string;
  category: string;
}

export interface FdaProfile {
  query: string;
  found: boolean;
  generic_name: string;
  brand_names?: string[];
  manufacturer?: string;
  route?: string;
  drug_class?: string;
  indications?: string;
  dosage?: string;
  boxed_warning?: string;
  warnings?: string;
  side_effects?: string;
  patient_info?: string;
  interactions?: string;
  effective_date?: string;
  label_url?: string;
  products: FdaProduct[];
  manufacturers: string[];
  faers: {
    total_reports: number;
    serious_reports: number;
    top_reactions: { term: string; count: number }[];
  };
  sources: { label: string; openfda: string };
  fetched_at: string;
}

export interface DoctorNotification {
  id: string;
  doctor_id: string;
  recipient_id?: string;
  kind: string;
  title: string;
  detail: string;
  patient_id: string;
  patient_label: string;
  call_id?: string | null;
  read: boolean;
  created_at: string;
}

export interface PatientBundle {
  patient: Patient;
  room: CareRoom | null;
  graph: GraphPayload;
  activity: ActivityEvent[];
  snapshot: Record<string, number>;
  connections?: Connections;
  briefing?: Briefing | null;
  tasks?: TeamTask[];
  presence?: PresenceUser[];
  attention?: Attention;
  handoff?: HandoffPack;
  team_activity?: TeamActivity[];
  office_calls?: OfficeCall[];
  muse?: { enabled: boolean };
  openai_rx?: { enabled: boolean };
  assistant?: { name: string; tts: "elevenlabs" | "browser"; brain: string };
}

export interface Analytics {
  updated_at: string;
  totals: Record<string, number>;
  patients: Array<Record<string, string | number | Attention | PresenceUser[]>>;
  activity: ActivityEvent[];
  handoffs?: HandoffPack[];
  attention_counts?: Record<string, number>;
  muse_enabled?: boolean;
  gemini_enabled?: boolean;
  openai_rx_enabled?: boolean;
}
