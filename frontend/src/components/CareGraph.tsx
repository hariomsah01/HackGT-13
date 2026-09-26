"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  Handle,
  Position,
  type Edge,
  type Node,
  type NodeMouseHandler,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphPayload } from "@/lib/types";

const typeColor: Record<string, string> = {
  patient: "#0F766E",
  doctor: "#1E293B",
  condition: "#1D4ED8",
  prescription: "#B45309",
};

const typeLabel: Record<string, string> = {
  patient: "Patient",
  doctor: "Doctor",
  condition: "Condition",
  prescription: "Medicine",
};

export type CareGraphSelection = {
  id: string;
  label: string;
  type: string;
  specialty?: string;
  role?: string;
  detail?: string;
};

type CareNodeData = {
  label: string;
  type: string;
  subtitle?: string;
  detail?: string;
  specialty?: string;
  role?: string;
  selected?: boolean;
};

function CareNode({ data }: NodeProps & { data: CareNodeData }) {
  const color = typeColor[data.type] || "#64748B";
  const isPatient = data.type === "patient";
  const selected = !!data.selected;
  return (
    <div
      className="relative px-3 py-2.5 text-center"
      style={{
        width: isPatient ? 168 : data.type === "doctor" ? 148 : 156,
        background: isPatient ? color : "#fff",
        color: isPatient ? "#fff" : "#0C1222",
        border: selected
          ? `2.5px solid ${color}`
          : isPatient
            ? "none"
            : `2px solid ${color}`,
        borderRadius: 14,
        boxShadow: selected
          ? `0 0 0 4px ${color}22, 0 12px 28px rgba(15,23,42,0.12)`
          : "0 8px 22px rgba(15,23,42,0.08)",
        fontWeight: selected || isPatient ? 700 : 600,
        lineHeight: 1.25,
      }}
    >
      <Handle type="target" position={Position.Top} className="!opacity-0" />
      <Handle type="source" position={Position.Bottom} className="!opacity-0" />
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      <Handle type="source" position={Position.Right} className="!opacity-0" />
      <p className="text-[13px] leading-snug">{data.label}</p>
      {data.subtitle ? (
        <p
          className="mt-1 text-[10px] font-semibold leading-snug"
          style={{ color: isPatient ? "rgba(255,255,255,0.85)" : "#64748b" }}
        >
          {data.subtitle}
        </p>
      ) : null}
      {data.detail ? (
        <p
          className="mt-0.5 text-[10px] font-medium leading-snug"
          style={{ color: isPatient ? "rgba(255,255,255,0.75)" : "#94a3b8" }}
        >
          {data.detail}
        </p>
      ) : null}
    </div>
  );
}

const nodeTypes = { care: CareNode };

export function CareGraph({
  graph,
  onSelect,
  heightClass = "h-[480px]",
  clean = false,
}: {
  graph: GraphPayload;
  onSelect?: (node: CareGraphSelection | null) => void;
  heightClass?: string;
  /** Simpler layout for patient Updates */
  clean?: boolean;
}) {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { nodes, edges } = useMemo(() => {
    const patient = graph.nodes.find((n) => n.type === "patient");
    const doctors = graph.nodes.filter((n) => n.type === "doctor");
    const conditions = graph.nodes.filter((n) => n.type === "condition");
    const meds = graph.nodes.filter((n) => n.type === "prescription");

    const ns: Node[] = [];
    const doctorGap = clean ? 155 : 168;
    const doctorRowWidth = Math.max(doctors.length - 1, 0) * doctorGap;
    const cx = clean ? 380 : 420;
    const cy = clean ? 230 : 260;
    const doctorY = clean ? 36 : 28;

    if (patient) {
      const city = patient.meta?.city;
      ns.push({
        id: patient.id,
        type: "care",
        position: { x: cx - 84, y: cy - 28 },
        data: {
          label: patient.label,
          type: "patient",
          subtitle: patient.meta?.age ? `Age ${patient.meta.age}` : undefined,
          detail: city || undefined,
          selected: selectedId === patient.id,
        } satisfies CareNodeData,
      });
    }

    // Doctors in a single non-overlapping row above the patient
    doctors.forEach((n, i) => {
      const startX = cx - doctorRowWidth / 2 - 74;
      ns.push({
        id: n.id,
        type: "care",
        position: {
          x: startX + i * doctorGap,
          y: doctorY,
        },
        data: {
          label: n.label,
          type: "doctor",
          subtitle: n.meta?.specialty || n.meta?.role,
          selected: selectedId === n.id,
          specialty: n.meta?.specialty,
          role: n.meta?.role,
        } satisfies CareNodeData,
      });
    });

    // Conditions left column — full labels, stacked with gap
    const condStartY = clean ? 120 : 130;
    conditions.forEach((n, i) => {
      ns.push({
        id: n.id,
        type: "care",
        position: {
          x: clean ? 24 : 16,
          y: condStartY + i * 78,
        },
        data: {
          label: wrapLabel(n.label, 22),
          type: "condition",
          subtitle: n.meta?.note ? wrapLabel(n.meta.note, 28) : undefined,
          selected: selectedId === n.id,
        } satisfies CareNodeData,
      });
    });

    // Medicines right — name + dose
    const medStartY = clean ? 120 : 130;
    meds.forEach((n, i) => {
      ns.push({
        id: n.id,
        type: "care",
        position: {
          x: clean ? 620 : 680,
          y: medStartY + i * 78,
        },
        data: {
          label: n.label,
          type: "prescription",
          subtitle: n.meta?.dose,
          detail: n.meta?.prescribed_by
            ? `by ${n.meta.prescribed_by}`
            : undefined,
          selected: selectedId === n.id,
        } satisfies CareNodeData,
      });
    });

    const keepEdge = (e: { label?: string }) => {
      if (!clean) return true;
      return e.label !== "has" && e.label !== "takes";
    };

    const es: Edge[] = graph.edges.filter(keepEdge).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: clean ? undefined : e.label,
      style: {
        stroke:
          selectedId && (e.source === selectedId || e.target === selectedId)
            ? "#0F766E"
            : "#CBD5E1",
        strokeWidth:
          selectedId && (e.source === selectedId || e.target === selectedId)
            ? 2.2
            : 1.3,
      },
      labelStyle: { fontSize: 10, fill: "#64748b" },
      labelBgStyle: { fill: "#F8FAFC", fillOpacity: 0.9 },
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 12,
        height: 12,
        color: "#94A3B8",
      },
    }));

    return { nodes: ns, edges: es };
  }, [graph, selectedId, clean]);

  function emit(id: string | null) {
    setSelectedId(id);
    if (!id) {
      onSelect?.(null);
      return;
    }
    const raw = graph.nodes.find((n) => n.id === id);
    if (!raw) {
      onSelect?.(null);
      return;
    }
    const detailBits = [
      raw.meta?.specialty,
      raw.meta?.dose,
      raw.meta?.reason,
      raw.meta?.note,
      raw.meta?.phone,
    ].filter(Boolean);
    onSelect?.({
      id: raw.id,
      label: raw.label,
      type: raw.type,
      specialty: raw.meta?.specialty,
      role: raw.meta?.role,
      detail: detailBits.join(" · ") || undefined,
    });
  }

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    emit(selectedId === node.id ? null : node.id);
  };

  const selected = selectedId
    ? graph.nodes.find((n) => n.id === selectedId)
    : null;

  return (
    <div className="space-y-3">
      <div
        className={`${heightClass} w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-gradient-to-br from-slate-50 via-white to-teal-50/40`}
      >
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          fitView
          fitViewOptions={{ padding: 0.22 }}
          minZoom={0.45}
          maxZoom={1.35}
          nodesDraggable={false}
          nodesConnectable={false}
          elementsSelectable
          panOnDrag
          zoomOnScroll
          onNodeClick={onNodeClick}
          onPaneClick={() => emit(null)}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={24} color="#E2E8F0" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-[11px] font-semibold text-[var(--muted)]">
        {(
          [
            ["patient", "Patient"],
            ["doctor", "Doctors"],
            ["condition", "Conditions"],
            ["prescription", "Medicines"],
          ] as const
        ).map(([key, label]) => (
          <span key={key} className="inline-flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-full"
              style={{ background: typeColor[key] }}
            />
            {label}
          </span>
        ))}
      </div>

      {selected ? (
        <div className="rounded-2xl border border-teal-700/20 bg-teal-50/60 px-4 py-3 text-sm">
          <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-teal-800">
            {careNodeKindLabel(selected.type)}
          </p>
          <p className="font-display mt-1 text-base font-bold text-[var(--ink)]">
            {selected.label}
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
            {[
              selected.meta?.specialty,
              selected.meta?.dose,
              selected.meta?.prescribed_by
                ? `Prescribed by ${selected.meta.prescribed_by}`
                : null,
              selected.meta?.reason,
              selected.meta?.note,
              selected.meta?.since ? `Since ${selected.meta.since}` : null,
              selected.meta?.phone,
            ]
              .filter(Boolean)
              .join(" · ") || "Part of this shared care map."}
          </p>
        </div>
      ) : (
        <p className="text-xs text-[var(--muted)]">
          Click a doctor, condition, or medicine for details.
        </p>
      )}
    </div>
  );
}

function wrapLabel(label: string, max: number) {
  if (label.length <= max) return label;
  const cut = label.slice(0, max);
  const space = cut.lastIndexOf(" ");
  if (space > 8) return `${cut.slice(0, space)}\n${label.slice(space + 1)}`;
  return `${label.slice(0, max - 1)}…`;
}

export function careNodeKindLabel(type: string) {
  return typeLabel[type] || "Item";
}
