from __future__ import annotations

import json
from typing import Optional

from fastapi import (
    APIRouter,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
    WebSocket,
    WebSocketDisconnect,
)

from app.engines.auth import assert_chart_access, authenticate, list_users_public, verify_token
from app.models.schemas import (
    AskRequest,
    LoginRequest,
    MessageRequest,
    NoteRequest,
    OfficeCallRequest,
    RxAddRequest,
    RxProposeRequest,
    RxStopRequest,
)

router = APIRouter(prefix="/api")


def eng(request: Request):
    return request.app.state.engine


def user_from(authorization: Optional[str]):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(401, "Please sign in")
    user = verify_token(authorization.removeprefix("Bearer ").strip())
    if not user:
        raise HTTPException(401, "Session expired — sign in again")
    return user


@router.get("/health")
def health(request: Request):
    e = eng(request)
    return {
        "status": "ok",
        "patients": len(e.store.list_patients()),
        "product": "ClearPath Care Space",
        "muse": e.muse.enabled,
        "gemini": e.ask.enabled,
        "openai_rx": e.rx.enabled,
    }


@router.get("/auth/users")
def users():
    return list_users_public()


@router.post("/auth/login")
def login(body: LoginRequest):
    result = authenticate(body.user_id, body.pin)
    if not result:
        raise HTTPException(401, "Wrong account or PIN")
    user, token = result
    return {"token": token, "user": user.model_dump()}


@router.get("/auth/me")
def me(authorization: Optional[str] = Header(default=None)):
    return user_from(authorization).model_dump()


@router.get("/patients")
def list_patients(request: Request, authorization: Optional[str] = Header(default=None)):
    user = user_from(authorization)
    return eng(request).list_patients_enriched(user)


@router.post("/patients")
def create_patient(
    request: Request, authorization: Optional[str] = Header(default=None)
):
    user = user_from(authorization)
    if user.kind != "doctor":
        raise HTTPException(403, "Only doctors can add patients")
    e = eng(request)
    patient = e.create_patient()
    e.store.log(
        user.id, user.label, patient.id, "created", f"{user.label} added {patient.label}"
    )
    return patient.model_dump()


@router.get("/patients/{patient_id}")
def get_patient(
    patient_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.open_patient(patient_id, user)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/patients/{patient_id}/messages")
def post_message(
    patient_id: str,
    body: MessageRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.post_message(
            patient_id,
            user,
            body.text.strip(),
            to_id=body.to_id,
            to_label=body.to_label,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/patients/{patient_id}/notes")
def add_note(
    patient_id: str,
    body: NoteRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        patient = e.add_note(patient_id, user, body.text)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return patient.model_dump()


@router.post("/patients/{patient_id}/brief")
def brief_room(
    patient_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user_from(authorization)
    e = eng(request)
    try:
        return e.brief(patient_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.post("/patients/{patient_id}/visit")
async def capture_visit(
    patient_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    audio: Optional[UploadFile] = File(default=None),
    demo: str = Form(default="false"),
    doctor_id: str = Form(default=""),
    reason: str = Form(default=""),
):
    """Legacy alias — office call intake (health assistant ↔ patient)."""
    user = user_from(authorization)
    e = eng(request)
    wav = await audio.read() if audio is not None else None
    use_demo = demo.lower() in ("1", "true", "yes") or not wav
    target = doctor_id.strip() or (user.id if user.kind == "doctor" else "")
    if not target:
        raise HTTPException(400, "Choose which doctor's office was called")
    try:
        return e.record_office_call(
            patient_id,
            user,
            target,
            reason=reason,
            wav_bytes=wav if not use_demo else None,
            demo=use_demo,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/patients/{patient_id}/office-call")
async def office_call(
    patient_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
    audio: Optional[UploadFile] = File(default=None),
    doctor_id: str = Form(default=""),
    reason: str = Form(default=""),
    demo: str = Form(default="true"),
):
    """Record a patient call to a doctor's office (health assistant intake)."""
    user = user_from(authorization)
    e = eng(request)
    # Prefer JSON body when no multipart file
    content_type = (request.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        raw = await request.json()
        body = OfficeCallRequest(**raw)
        try:
            return e.record_office_call(
                patient_id,
                user,
                body.doctor_id,
                reason=body.reason,
                demo=body.demo,
                transcript_override=body.transcript,
            )
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc

    wav = await audio.read() if audio is not None else None
    use_demo = demo.lower() in ("1", "true", "yes") or not wav
    if not doctor_id.strip():
        raise HTTPException(400, "Choose which doctor's office was called")
    try:
        return e.record_office_call(
            patient_id,
            user,
            doctor_id.strip(),
            reason=reason,
            wav_bytes=wav if not use_demo else None,
            demo=use_demo,
        )
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.get("/notifications")
def notifications(
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.list_doctor_notifications(user)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/notifications/{note_id}/read")
def read_notification(
    note_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.mark_notification_read(user, note_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/office-calls/{call_id}/responded")
def office_call_responded(
    call_id: str,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.mark_office_call_responded(user, call_id)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# Chart opens / Ask probes stay out of patient-facing feeds
_PRIVATE_ACTIVITY = frozenset({"viewed", "ask"})
_PATIENT_ACTIVITY = frozenset(
    {"message", "note", "rx_add", "rx_analyze", "rx_stop", "visit", "office_call", "brief"}
)


@router.get("/activity")
def activity(
    request: Request,
    patient_id: Optional[str] = None,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    if user.kind == "patient":
        patient_id = user.chart_id
        if not patient_id:
            return []
    elif patient_id:
        try:
            assert_chart_access(user, patient_id)
        except PermissionError as exc:
            raise HTTPException(403, str(exc)) from exc
    items = e.store.activity_feed(patient_id=patient_id, limit=60)
    items = [a for a in items if a.kind not in _PRIVATE_ACTIVITY]
    if user.kind == "patient":
        items = [a for a in items if a.kind in _PATIENT_ACTIVITY]
    return [a.model_dump() for a in items[:40]]


@router.get("/analytics")
def analytics(
    request: Request, authorization: Optional[str] = Header(default=None)
):
    user_from(authorization)
    return eng(request).analytics()


@router.post("/patients/{patient_id}/summary")
def summary(
    patient_id: str,
    body: AskRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    user = user_from(authorization)
    e = eng(request)
    try:
        text = e.patient_summary(patient_id, body.question, user=user)
    except PermissionError as exc:
        raise HTTPException(403, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"text": text}


@router.post("/ask")
def ask_screen(
    body: AskRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Ask across the whole care platform (Gemini + chart fallback)."""
    user = user_from(authorization)
    e = eng(request)
    return e.ask_screen(
        body.question,
        user,
        body.patient_id,
        body.tab,
        body.screen,
    )


@router.get("/handoffs")
def handoffs(
    request: Request, authorization: Optional[str] = Header(default=None)
):
    """Attention handoffs across the shared care space."""
    user = user_from(authorization)
    e = eng(request)
    analytics = e.analytics()
    packs = analytics.get("handoffs") or []
    if user.kind == "patient" and user.chart_id:
        packs = [h for h in packs if h.get("patient_id") == user.chart_id]
    return {
        "handoffs": packs,
        "attention_counts": analytics.get("attention_counts") or {},
        "updated_at": analytics.get("updated_at"),
    }


@router.post("/patients/{patient_id}/rx/analyze")
def analyze_rx(
    patient_id: str,
    body: RxProposeRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Analyze a proposed prescription against the shared multi-doctor chart."""
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.analyze_prescription(
            patient_id,
            user,
            body.name,
            body.dose,
            body.frequency,
            body.reason,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/patients/{patient_id}/rx")
def add_rx(
    patient_id: str,
    body: RxAddRequest,
    request: Request,
    authorization: Optional[str] = Header(default=None),
):
    """Add a prescription to the shared chart after (optional) analysis."""
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.add_prescription(
            patient_id,
            user,
            body.name,
            body.dose,
            body.frequency,
            body.reason,
            body.analysis_severity,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@router.post("/patients/{patient_id}/rx/{rx_id}/stop")
def stop_rx(
    patient_id: str,
    rx_id: str,
    request: Request,
    body: Optional[RxStopRequest] = None,
    authorization: Optional[str] = Header(default=None),
):
    """Prescribing doctor removes/stops a medicine when the course is complete."""
    user = user_from(authorization)
    e = eng(request)
    try:
        return e.stop_prescription(
            patient_id,
            user,
            rx_id,
            (body.reason if body else "") or "Course completed",
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ── Real-time room WebSocket ─────────────────────────────────

class RoomHub:
    def __init__(self) -> None:
        self.rooms: dict[str, set[WebSocket]] = {}

    async def join(self, patient_id: str, ws: WebSocket) -> None:
        await ws.accept()
        self.rooms.setdefault(patient_id, set()).add(ws)

    def leave(self, patient_id: str, ws: WebSocket) -> None:
        if patient_id in self.rooms:
            self.rooms[patient_id].discard(ws)

    async def broadcast(self, patient_id: str, payload: dict) -> None:
        dead = []
        for ws in list(self.rooms.get(patient_id, set())):
            try:
                await ws.send_text(json.dumps(payload))
            except Exception:  # noqa: BLE001
                dead.append(ws)
        for ws in dead:
            self.leave(patient_id, ws)


hub = RoomHub()


@router.websocket("/ws/{patient_id}")
async def room_socket(websocket: WebSocket, patient_id: str):
    """Live presence + event fanout for a patient room."""
    token = websocket.query_params.get("token")
    user = verify_token(token or "")
    if not user:
        await websocket.close(code=4401)
        return

    engine = websocket.app.state.engine
    try:
        assert_chart_access(user, patient_id)
    except PermissionError:
        await websocket.close(code=4403)
        return

    await hub.join(patient_id, websocket)
    presence = engine.store.set_presence(patient_id, user.id, user.label, user.kind)
    await hub.broadcast(
        patient_id,
        {"type": "presence", "presence": presence, "actor": user.label},
    )

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                continue
            kind = data.get("type")
            if kind == "ping":
                await websocket.send_text(json.dumps({"type": "pong"}))
            elif kind == "message" and data.get("text"):
                result = engine.post_message(
                    patient_id,
                    user,
                    data["text"],
                    to_id=data.get("to_id"),
                    to_label=data.get("to_label"),
                )
                await hub.broadcast(
                    patient_id,
                    {
                        "type": "room_update",
                        "room": result["room"],
                        "briefing": result.get("briefing"),
                        "private": result.get("private", False),
                        "actor": user.label,
                    },
                )
            elif kind == "brief":
                briefing = engine.brief(patient_id)
                await hub.broadcast(
                    patient_id,
                    {"type": "briefing", "briefing": briefing, "actor": user.label},
                )
    except WebSocketDisconnect:
        presence = engine.store.clear_presence(patient_id, user.id)
        await hub.broadcast(
            patient_id,
            {"type": "presence", "presence": presence, "actor": user.label},
        )
        hub.leave(patient_id, websocket)
