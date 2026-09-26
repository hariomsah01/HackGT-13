"use client";

import { useMemo } from "react";
import {
  ReactFlow,
  Background,
  Controls,
  MarkerType,
  type Edge,
  type Node,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import type { GraphPayload } from "@/lib/types";

const colors: Record<string, string> = {
  patient: "#0f766e",
  doctor: "#1e293b",
  condition: "#0369a1",
  prescription: "#b45309",
};

export function CareGraph({ graph }: { graph: GraphPayload }) {
  const { nodes, edges } = useMemo(() => {
    const patient = graph.nodes.find((n) => n.type === "patient");
    const others = graph.nodes.filter((n) => n.type !== "patient");
    const cx = 380;
    const cy = 240;
    const radius = 200;

    const ns: Node[] = [];
    if (patient) {
      ns.push({
        id: patient.id,
        position: { x: cx - 60, y: cy - 24 },
        data: { label: patient.label },
        style: {
          background: colors.patient,
          color: "#fff",
          borderRadius: 14,
          padding: 12,
          fontWeight: 700,
          width: 120,
          textAlign: "center",
          border: "none",
        },
      });
    }

    others.forEach((n, i) => {
      const ang = (2 * Math.PI * i) / Math.max(others.length, 1) - Math.PI / 2;
      ns.push({
        id: n.id,
        position: {
          x: cx + radius * Math.cos(ang) - 55,
          y: cy + radius * Math.sin(ang) - 20,
        },
        data: {
          label: n.meta?.specialty
            ? `${n.label}\n${n.meta.specialty}`
            : n.label,
        },
        style: {
          background: "#fff",
          color: "#0c1222",
          border: `2px solid ${colors[n.type] || "#94a3b8"}`,
          borderRadius: 12,
          padding: 8,
          fontSize: 12,
          width: 120,
          whiteSpace: "pre-wrap",
          textAlign: "center",
        },
      });
    });

    const es: Edge[] = graph.edges.map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      label: e.label,
      style: { stroke: "#94a3b8", strokeWidth: 1.4 },
      labelStyle: { fontSize: 10, fill: "#64748b" },
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14 },
    }));

    return { nodes: ns, edges: es };
  }, [graph]);

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-2xl border border-[var(--line)] bg-[#fbfcfe]">
      <ReactFlow nodes={nodes} edges={edges} fitView>
        <Background gap={20} color="#e2e8f0" />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  );
}
