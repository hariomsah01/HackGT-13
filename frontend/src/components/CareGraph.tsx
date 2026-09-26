"use client";

import { useMemo, useState } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
  type NodeMouseHandler,
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
  patient: "You",
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
};

export function CareGraph({
  graph,
  onSelect,
  heightClass = "h-[420px]",
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
    const cx = 400;
    const cy = clean ? 200 : 240;

    if (patient) {
      ns.push({
        id: patient.id,
        position: { x: cx - 70, y: cy - 28 },
        data: { label: patient.label, type: "patient" },
        style: nodeStyle("patient", selectedId === patient.id, clean),
      });
    }

    // Doctors on top arc
    doctors.forEach((n, i) => {
      const count = Math.max(doctors.length, 1);
      const spread = Math.min(Math.PI * 0.85, 0.55 * count);
      const start = -Math.PI / 2 - spread / 2;
      const ang = start + (spread * (i + 0.5)) / count;
      const radius = clean ? 150 : 175;
      ns.push({
        id: n.id,
        position: {
          x: cx + radius * Math.cos(ang) - 60,
          y: cy + radius * Math.sin(ang) - 22,
        },
        data: {
          label: clean ? n.label : n.meta?.specialty ? `${n.label}\n${n.meta.specialty}` : n.label,
          type: "doctor",
          specialty: n.meta?.specialty,
          role: n.meta?.role,
        },
        style: nodeStyle("doctor", selectedId === n.id, clean),
      });
    });

    // Conditions left
    conditions.forEach((n, i) => {
      ns.push({
        id: n.id,
        position: {
          x: clean ? 40 : 30,
          y: 40 + i * (clean ? 58 : 64),
        },
        data: { label: shortLabel(n.label, clean ? 22 : 28), type: "condition", full: n.label },
        style: nodeStyle("condition", selectedId === n.id, clean),
      });
    });

    // Medicines right
    meds.forEach((n, i) => {
      ns.push({
        id: n.id,
        position: {
          x: clean ? 640 : 620,
          y: 40 + i * (clean ? 58 : 64),
        },
        data: { label: shortLabel(n.label, clean ? 18 : 22), type: "prescription", full: n.label },
        style: nodeStyle("prescription", selectedId === n.id, clean),
      });
    });

    const keepEdge = (e: { label?: string }) => {
      if (!clean) return true;
      // Fewer labels in clean mode: only doctor specialty links
      return e.label !== "has" && e.label !== "takes";
    };

    const es: Edge[] = graph.edges.filter(keepEdge).map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: clean ? undefined : e.label,
      style: {
        stroke: selectedId && (e.source === selectedId || e.target === selectedId)
          ? "#0F766E"
          : "#CBD5E1",
        strokeWidth:
          selectedId && (e.source === selectedId || e.target === selectedId) ? 2.2 : 1.3,
      },
      labelStyle: { fontSize: 10, fill: "#64748b" },
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
    onSelect?.({
      id: raw.id,
      label: raw.label,
      type: raw.type,
      specialty: raw.meta?.specialty,
      role: raw.meta?.role,
    });
  }

  const onNodeClick: NodeMouseHandler = (_evt, node) => {
    emit(selectedId === node.id ? null : node.id);
  };

  return (
    <div
      className={`${heightClass} w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[#F8FAFC]`}
    >
      <ReactFlow
        nodes={nodes}
        edges={edges}
        fitView
        fitViewOptions={{ padding: 0.18 }}
        minZoom={0.55}
        maxZoom={1.4}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnDrag
        zoomOnScroll
        onNodeClick={onNodeClick}
        onPaneClick={() => emit(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={22} color="#E2E8F0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}

function shortLabel(label: string, max: number) {
  if (label.length <= max) return label;
  return `${label.slice(0, max - 1)}…`;
}

function nodeStyle(type: string, selected: boolean, clean: boolean) {
  const color = typeColor[type] || "#64748B";
  const isPatient = type === "patient";
  return {
    background: isPatient ? color : "#fff",
    color: isPatient ? "#fff" : "#0C1222",
    border: selected ? `2.5px solid ${color}` : isPatient ? "none" : `2px solid ${color}`,
    borderRadius: clean ? 14 : 12,
    padding: clean ? "10px 12px" : 8,
    fontSize: clean ? 13 : 12,
    fontWeight: selected || isPatient ? 700 : 600,
    width: clean ? (isPatient ? 140 : 120) : 120,
    textAlign: "center" as const,
    whiteSpace: "pre-wrap" as const,
    boxShadow: selected ? `0 0 0 4px ${color}22` : "0 4px 14px rgba(15,23,42,0.06)",
    cursor: "pointer",
    lineHeight: 1.25,
  };
}

export function careNodeKindLabel(type: string) {
  return typeLabel[type] || "Item";
}
