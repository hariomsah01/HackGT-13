from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers.api import router
from app.services.engine import CareEngine
from app.services.store import CareStore


VERCEL_PREFIX = "/api/backend"


class StripPrefixMiddleware:
    """Vercel forwards /api/backend/... to this service; routes are mounted at /api/..."""

    def __init__(self, app, prefix: str) -> None:
        self.app = app
        self.prefix = prefix

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            path = scope.get("path", "")
            if path == self.prefix or path.startswith(self.prefix + "/"):
                scope = dict(scope)
                scope["path"] = path[len(self.prefix):] or "/"
                raw = scope.get("raw_path")
                if raw:
                    scope["raw_path"] = raw[len(self.prefix):] or b"/"
        await self.app(scope, receive, send)


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title="ClearPath Care Space",
        description="Shared care room for Doctor A–D and patients — Meta track",
        version="2.0.0",
    )
    origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins or ["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.add_middleware(StripPrefixMiddleware, prefix=VERCEL_PREFIX)
    app.state.engine = CareEngine(CareStore())
    app.state.settings = settings
    app.include_router(router)

    @app.get("/")
    def root():
        return {"name": "ClearPath Care Space", "docs": "/docs"}

    return app


app = create_app()
