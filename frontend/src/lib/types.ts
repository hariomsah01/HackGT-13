export type UserKind = "doctor" | "patient";

export interface SessionUser {
  id: string;
  label: string;
  kind: UserKind;
  role: string;
  specialty: string;
  color: string;
}

export interface PublicUser extends SessionUser {
  pin_hint: string;
}

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
}

export interface RoomMessage {
  id: string;
  author_id: string;
  author_label: string;
  text: string;
  timestamp: string;
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
  muse?: { enabled: boolean };
}

export interface Analytics {
  updated_at: string;
  totals: Record<string, number>;
  patients: Array<Record<string, string | number>>;
  activity: ActivityEvent[];
  muse_enabled?: boolean;
}
