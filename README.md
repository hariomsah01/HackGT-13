# ClearPath — Shared Care Space (Meta track)

**Bringing people closer together with AI** — Doctors A–D and Patient 1… share one living chart, a live team room, and visit capture so nobody re-explains their story.

## Stack

| Layer | Tech |
|-------|------|
| Real-time room | FastAPI WebSocket presence + message fanout |
| Muse Spark | Agentic tool loop → team briefing + tasks |
| Muse Voice | Visit audio → transcript → structured shared note |
| Connection intel | Bond scores across doctors ↔ patient |
| App | Next.js multi-tab care space |

## Run

```bash
cd backend
pip install -r requirements.txt
# optional: set MODEL_API_KEY in .env (from https://dev.meta.ai)
uvicorn app.main:app --reload --port 8000

cd frontend
npm install && npm run dev
```

## Sign in

| Who | PIN |
|-----|-----|
| Doctor A–D | `1111` `2222` `3333` `4444` |
| Patient | `0000` |

## Demo (Meta video)

1. **Problem (30s)** — Care is fragmented; patients repeat histories.  
2. **Product (90s)** — Doctor A & B open Patient 1; Talk; live presence; Team bond; Visit capture → shared note; Patient “My care”.  
3. **AI (30s)** — Muse Spark tools brief the room; Muse Voice turns speech into shared understanding (never labeled “AI” in UI).  
4. **Tools (30s)** — Next.js, FastAPI, WebSockets, Meta Model API (`muse-spark-1.3`, `muse-voice-transcribe-1.0`).

Get $50 Muse credits: [dev.meta.ai](https://dev.meta.ai/)
