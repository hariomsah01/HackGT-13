"""Care team graph for one patient."""
from __future__ import annotations

from app.models.schemas import Patient


def build_care_graph(patient: Patient) -> dict:
    nodes = [
        {
            "id": patient.id,
            "label": patient.label,
            "type": "patient",
            "status": "active",
        }
    ]
    edges = []

    for c in patient.conditions:
        nid = f"cond_{c.id}"
        nodes.append({"id": nid, "label": c.name, "type": "condition", "status": "ok"})
        edges.append(
            {"id": f"e_{patient.id}_{nid}", "source": patient.id, "target": nid, "label": "has"}
        )

    for m in patient.team:
        nodes.append(
            {
                "id": m.id,
                "label": m.label,
                "type": "doctor",
                "status": "ok",
                "meta": {"role": m.role, "specialty": m.specialty},
            }
        )
        edges.append(
            {
                "id": f"e_{patient.id}_{m.id}",
                "source": patient.id,
                "target": m.id,
                "label": m.specialty or m.role,
            }
        )

    for rx in patient.prescriptions:
        if rx.status != "active":
            continue
        nodes.append(
            {"id": rx.id, "label": rx.name, "type": "prescription", "status": "ok"}
        )
        edges.append(
            {
                "id": f"e_{patient.id}_{rx.id}",
                "source": patient.id,
                "target": rx.id,
                "label": "takes",
            }
        )
        edges.append(
            {
                "id": f"e_{rx.prescribed_by}_{rx.id}",
                "source": rx.prescribed_by,
                "target": rx.id,
                "label": "prescribed",
            }
        )

    return {"nodes": nodes, "edges": edges}
