import asyncio
import time
import httpx
from datetime import datetime, timezone
from typing import Any

BASE_URL  = "https://api.openf1.org/v1"
TOKEN_URL = "https://api.openf1.org/token"

_client: httpx.AsyncClient | None = None
_cache: dict[str, tuple[float, Any]] = {}
_rate_lock: asyncio.Lock | None = None
_last_request_time: float = 0.0
_request_count: int = 0          # used to trigger periodic cache eviction

CACHE_TTL = 120         # seconds — 2 min keeps historical GPS buckets warm across seeks
MIN_REQUEST_INTERVAL = 0.38  # ≈ 2.6 req/s, safely under OpenF1's 3 req/s limit

# ── Auth state ─────────────────────────────────────────────────────────────────
_auth_required:   bool      = False  # set True the first time OpenF1 returns 401
_access_token:    str | None = None
_token_expires_at: float    = 0.0   # time.monotonic() when the token expires


def get_auth_status() -> dict:
    """Return current authentication state (called by the /api/auth/status endpoint)."""
    authenticated = bool(_access_token) and time.monotonic() < _token_expires_at
    return {"auth_required": _auth_required, "authenticated": authenticated}


async def login(username: str, password: str) -> bool:
    """POST credentials to OpenF1 /token.  Stores the token on success."""
    global _access_token, _token_expires_at
    try:
        async with httpx.AsyncClient(timeout=15.0) as c:
            resp = await c.post(
                TOKEN_URL,
                data={"username": username, "password": password},
                headers={"Content-Type": "application/x-www-form-urlencoded"},
            )
            if resp.status_code != 200:
                return False
            body = resp.json()
            token = body.get("access_token")
            if not token:
                return False
            _access_token = token
            expires_in = int(body.get("expires_in", 3600))
            _token_expires_at = time.monotonic() + expires_in - 60   # 60 s safety margin
            return True
    except Exception:
        return False


def _evict_stale_cache() -> None:
    """Remove entries whose TTL has expired.  Called every N requests to prevent
    unbounded growth: at x15 playback speed stream buckets change every 4 s, so
    after an hour ~900 dead entries (≈270 MB) accumulate without this cleanup."""
    cutoff = time.monotonic() - CACHE_TTL
    stale = [k for k, (ts, _) in list(_cache.items()) if ts < cutoff]
    for k in stale:
        del _cache[k]


def get_rate_lock() -> asyncio.Lock:
    """Lazy-init lock — serialises all OpenF1 requests and enforces rate limit."""
    global _rate_lock
    if _rate_lock is None:
        _rate_lock = asyncio.Lock()
    return _rate_lock


def get_client() -> httpx.AsyncClient:
    global _client
    if _client is None or _client.is_closed:
        _client = httpx.AsyncClient(base_url=BASE_URL, timeout=45.0)
    return _client


def _utc_str(dt: datetime) -> str:
    """Return a UTC ISO string without timezone suffix (format expected by OpenF1)."""
    if dt.tzinfo:
        dt = dt.astimezone(timezone.utc).replace(tzinfo=None)
    return dt.strftime("%Y-%m-%dT%H:%M:%S")


async def fetch(
    endpoint: str,
    params: dict[str, Any] | None = None,
    before: str | None = None,
    after: str | None = None,
    fast_fail: bool = False,
) -> list[dict]:
    """
    Fetch from OpenF1.
    `before`     → adds `date<={before}` filter.
    `after`      → adds `date>={after}` filter.
    `fast_fail`  → if True, return [] immediately on a 429 (no retry/sleep).
    OpenF1 uses literal < / > operators in query strings, not percent-encoded.

    Returns [] on 401 (authentication required) so callers get a safe empty
    list instead of a 500 crash.
    """
    cache_parts = [endpoint]
    if params:
        cache_parts.append("&".join(f"{k}={v}" for k, v in sorted(params.items())))
    if after:
        cache_parts.append(f"after={after}")
    if before:
        cache_parts.append(f"before={before}")
    key = "|".join(cache_parts)

    global _request_count
    now = time.monotonic()
    if key in _cache:
        ts, data = _cache[key]
        if now - ts < CACHE_TTL:
            return data

    # Evict stale entries every 50 requests so the cache doesn't grow to hundreds
    # of MB during long scrub-mode sessions at high play speeds.
    _request_count += 1
    if _request_count % 50 == 0:
        _evict_stale_cache()

    url_parts: list[str] = []
    if params:
        url_parts.extend(f"{k}={v}" for k, v in params.items())
    if after:
        url_parts.append(f"date>={after}")
    if before:
        url_parts.append(f"date<={before}")
    url = endpoint + ("?" + "&".join(url_parts) if url_parts else "")

    global _last_request_time
    lock = get_rate_lock()
    max_attempts = 1 if fast_fail else 3
    for attempt in range(max_attempts):
        try:
            # Acquire lock only long enough to enforce the minimum start interval.
            # The HTTP call runs OUTSIDE the lock so asyncio.gather() requests are
            # truly concurrent — each just waits 0.38 s before starting, then all
            # fly in parallel.  Without this, the lock was held for the full RTT
            # (~1 s), serialising every gather() into N × 1 s instead of ~0.38×N.
            async with lock:
                elapsed = time.monotonic() - _last_request_time
                if elapsed < MIN_REQUEST_INTERVAL:
                    await asyncio.sleep(MIN_REQUEST_INTERVAL - elapsed)
                _last_request_time = time.monotonic()
            # Include Bearer token when authenticated
            token = _access_token if (_access_token and time.monotonic() < _token_expires_at) else None
            headers = {"Authorization": f"Bearer {token}"} if token else {}
            resp = await get_client().get(url, headers=headers)

            if resp.status_code == 429:
                if fast_fail:
                    return []          # caller tolerates a miss; don't block
                await asyncio.sleep(2.0 * (attempt + 1))
                continue

            if resp.status_code == 401:
                # Signal to the frontend that auth is needed, but never crash.
                global _auth_required
                _auth_required = True
                return []

            resp.raise_for_status()
            data = resp.json()
            # OpenF1 always returns a JSON array on success.  A dict response is
            # an error payload (e.g. {"detail": "..."}) — never cache it; return []
            # so callers get a safe empty list and the next request re-fetches live.
            if not isinstance(data, list):
                return []
            _cache[key] = (time.monotonic(), data)
            return data
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429 and not fast_fail and attempt < 2:
                await asyncio.sleep(2.0 * (attempt + 1))
                continue
            if fast_fail:
                return []
            raise
        except (httpx.RequestError, httpx.ReadTimeout):
            if not fast_fail and attempt < 2:
                await asyncio.sleep(1.5)
                continue
            return []
    return []


# ── convenience wrappers ──────────────────────────────────────────────────────

async def get_meetings(year: int) -> list[dict]:
    return await fetch("/meetings", {"year": year})


async def get_sessions(meeting_key: int) -> list[dict]:
    return await fetch("/sessions", {"meeting_key": meeting_key})


async def get_latest_session() -> dict | None:
    sessions = await fetch("/sessions", {"session_key": "latest"})
    return sessions[0] if sessions else None


async def get_drivers(session_key: int | str) -> list[dict]:
    return await fetch("/drivers", {"session_key": session_key})


async def get_laps(
    session_key: int | str,
    driver_number: int | None = None,
    before: str | None = None,
) -> list[dict]:
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number is not None:
        params["driver_number"] = driver_number
    return await fetch("/laps", params, before=before)


async def get_intervals(session_key: int | str, before: str | None = None) -> list[dict]:
    return await fetch("/intervals", {"session_key": session_key}, before=before)


async def get_positions(
    session_key: int | str,
    driver_number: int | None = None,
    before: str | None = None,
    after: str | None = None,
) -> list[dict]:
    """Race standings positions (P1, P2…). NOT map coordinates."""
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number is not None:
        params["driver_number"] = driver_number
    return await fetch("/position", params, before=before, after=after)


async def get_location(
    session_key: int | str,
    driver_number: int | None = None,
    before: str | None = None,
    after: str | None = None,
    fast_fail: bool = False,
) -> list[dict]:
    """GPS track coordinates (x, y, z) for each car — used by the track map."""
    params: dict[str, Any] = {"session_key": session_key}
    if driver_number is not None:
        params["driver_number"] = driver_number
    return await fetch("/location", params, before=before, after=after, fast_fail=fast_fail)


async def get_stints(session_key: int | str) -> list[dict]:
    return await fetch("/stints", {"session_key": session_key})


async def get_pit(session_key: int | str) -> list[dict]:
    return await fetch("/pit", {"session_key": session_key})


async def get_car_data(session_key: int | str, driver_number: int) -> list[dict]:
    return await fetch("/car_data", {"session_key": session_key, "driver_number": driver_number})


async def get_team_radio(session_key: int | str) -> list[dict]:
    return await fetch("/team_radio", {"session_key": session_key})


async def get_race_control(session_key: int | str) -> list[dict]:
    return await fetch("/race_control", {"session_key": session_key})


async def get_weather(session_key: int | str) -> list[dict]:
    return await fetch("/weather", {"session_key": session_key})
