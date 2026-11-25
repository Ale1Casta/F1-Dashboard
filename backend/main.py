import os
import mimetypes

# ── Force correct MIME types ──────────────────────────────────────────────────
# On Windows the registry sometimes maps .js → text/plain.
# Mobile Chrome enforces strict MIME checking for ES-module scripts and will
# silently refuse to execute them if the Content-Type is wrong (no error in
# window.onerror, just a blank page).  Fix this before StaticFiles is mounted.
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("application/javascript", ".mjs")
mimetypes.add_type("text/css",               ".css")
mimetypes.add_type("application/json",       ".json")
mimetypes.add_type("image/svg+xml",          ".svg")
mimetypes.add_type("image/png",              ".png")
mimetypes.add_type("image/webp",             ".webp")

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from routers import sessions, live, ws

app = FastAPI(title="F1 Dashboard API", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    # In tunnel mode the frontend is served from the same origin → CORS is irrelevant.
    # "localhost:5173" keeps local Vite dev working; "*" covers any tunnel URL.
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions.router, prefix="/api")
app.include_router(live.router, prefix="/api")
app.include_router(ws.router)


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/api/auth/status")
def auth_status():
    """Return whether OpenF1 requires auth and whether the user is logged in."""
    from services.openf1_client import get_auth_status
    return get_auth_status()


@app.post("/api/auth/login")
async def auth_login(body: dict):
    """Try to log in to OpenF1 with the provided credentials.
    On success clears the cache so next requests use the new token."""
    from services import openf1_client as of1
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", "")).strip()
    if not username or not password:
        return {"ok": False, "error": "Inserisci email e password"}
    ok = await of1.login(username, password)
    if ok:
        of1._cache.clear()   # force fresh fetch with new token
        of1._auth_required = False
    return {"ok": ok, "error": None if ok else "Credenziali non valide — verifica email e password"}


@app.get("/api/debug/mime")
def debug_mime():
    """Return the MIME types Python resolves for key frontend asset extensions."""
    import mimetypes as _m
    return {
        ".js":   _m.guess_type("x.js")[0],
        ".mjs":  _m.guess_type("x.mjs")[0],
        ".css":  _m.guess_type("x.css")[0],
        ".json": _m.guess_type("x.json")[0],
        ".svg":  _m.guess_type("x.svg")[0],
    }


# ── Serve the compiled React frontend ────────────────────────────────────────
# Only mounted when `frontend/dist/` exists (production build).
# In local dev you still use `npm run dev` on :5173 as usual.
# Must be registered LAST so API routes take priority over the catch-all.
_dist = os.path.join(os.path.dirname(__file__), "..", "frontend", "dist")
if os.path.isdir(_dist):
    app.mount("/", StaticFiles(directory=_dist, html=True), name="static")
