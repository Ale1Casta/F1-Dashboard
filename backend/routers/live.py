import asyncio
import re
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Query as QParam
from services import openf1_client as of1

router = APIRouter(prefix="/sessions/{session_key}", tags=["live"])


async def safe(coro):
    try:
        return await coro
    except Exception:
        return []


@router.get("/laps")
async def laps(session_key: int, driver_number: int | None = None):
    return await of1.get_laps(session_key, driver_number)


@router.get("/intervals")
async def intervals(session_key: int):
    return await of1.get_intervals(session_key)


@router.get("/positions")
async def positions(session_key: int, before: str | None = None):
    """Latest GPS location per driver, using a 30-second window to cap data size."""
    try:
        if before:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
        else:
            before_dt = datetime.now(timezone.utc)
        after_dt = before_dt - timedelta(seconds=30)
        before_str = before_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        after_str = after_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        return []
    data = await safe(of1.get_location(session_key, before=before_str, after=after_str))
    latest: dict[int, dict] = {}
    for p in data:
        dn = p.get("driver_number")
        if dn not in latest or p.get("date", "") > latest[dn].get("date", ""):
            latest[dn] = p
    return list(latest.values())


@router.get("/positions/stream")
async def positions_stream(session_key: int, after: str | None = None, before: str | None = None):
    """All GPS points for all drivers in a time window, sorted by date.
    Used by the frontend for smooth scrub-mode animation (real GPS density ~4 Hz)."""
    try:
        if before:
            before_dt = datetime.fromisoformat(before.replace("Z", "+00:00"))
        else:
            before_dt = datetime.now(timezone.utc)
        if after:
            after_dt = datetime.fromisoformat(after.replace("Z", "+00:00"))
        else:
            after_dt = before_dt - timedelta(seconds=90)
        before_str = before_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        after_str  = after_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    except Exception:
        return []
    # fast_fail=True: if OpenF1 returns 429, return [] immediately instead of
    # sleeping 2–6 s.  The frontend uses keepPreviousData so a single miss just
    # holds the previous bucket — far better than blocking all other requests.
    data = await safe(of1.get_location(session_key, before=before_str, after=after_str, fast_fail=True))
    if not data:
        return []
    # Per-driver sampling: guarantee even coverage for every driver.
    # Global sampling would skip drivers with few data points entirely.
    by_driver: dict[int, list] = {}
    for p in data:
        by_driver.setdefault(p.get("driver_number"), []).append(p)
    result = []
    MAX_PER_DRIVER = 300  # ~1 pt / 0.4 s at 4 Hz over 120 s — stays on-track at F1 speeds
    for pts in by_driver.values():
        pts.sort(key=lambda p: p.get("date", ""))
        step = max(1, len(pts) // MAX_PER_DRIVER)
        for p in pts[::step]:
            try:
                dt = datetime.fromisoformat(p["date"].replace("Z", "+00:00"))
                t_ms = int(dt.timestamp() * 1000)
            except Exception:
                continue
            dn = p.get("driver_number")
            x  = p.get("x")
            y  = p.get("y")
            if dn is None or x is None or y is None:
                continue
            # Return only the three fields the map needs + a pre-computed integer
            # timestamp.  This shrinks the payload ~65 % (no ISO strings, no z/
            # session_key/meeting_key) and lets the frontend skip 6 000 new Date()
            # calls per stream load.
            result.append({"driver_number": dn, "x": x, "y": y, "t": t_ms})
    result.sort(key=lambda p: p["t"])
    return result


@router.get("/positions/circuit")
async def positions_circuit(session_key: int):
    """Circuit outline: single clean lap's GPS trace for accurate track shape.

    Key design decisions:
    - Always fetches ONE driver's data (not all 20) — avoids ~57 k-point timeouts.
    - Always uses a WIDE session-start window for the HTTP fetch — narrow windows
      can return 404 from OpenF1 even when data exists (confirmed on Austrian GP
      FP1: lap-3 2-min window → 404, session 15-min window → 1441 pts OK).
    - The lap timestamps from the /laps endpoint are only used to *slice* the
      resulting points down to a single clean lap, not as the fetch window.
    """
    sessions_data = await safe(of1.fetch("/sessions", {"session_key": session_key}))
    if not sessions_data:
        return []
    date_start = sessions_data[0].get("date_start")
    if not date_start:
        return []
    try:
        start = datetime.fromisoformat(date_start.replace("Z", "+00:00"))
    except Exception:
        return []

    # Wide fetch window: minutes 3–20 from session start.
    # Wide enough to contain several early laps regardless of session type;
    # single-driver keeps payload at ~2–3 k points (not 57 k for all 20).
    wide_after  = (start + timedelta(minutes=3)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
    wide_before = (start + timedelta(minutes=20)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    # ── Identify the best driver and a target lap window ─────────────────────
    laps_data = await safe(of1.get_laps(session_key))

    chosen_driver: int | None = None
    lap_after: str | None = None    # start of a clean lap (used to slice, not fetch)
    lap_before: str | None = None   # end of that lap + small buffer

    if laps_data:
        # Build per-driver sorted lap lists (only laps with a date_start)
        driver_laps: dict[int, list] = {}
        for l in laps_data:
            dn = l.get("driver_number")
            if dn and l.get("date_start"):
                driver_laps.setdefault(int(dn), []).append(l)
        for dn in driver_laps:
            driver_laps[dn].sort(key=lambda l: l.get("lap_number", 0))

        # Pass 1a — lap has explicit duration (races, qualifying, most practice laps)
        for dn, dlaps in driver_laps.items():
            for lap in dlaps:
                if not (3 <= (lap.get("lap_number") or 0) <= 8):
                    continue
                if not lap.get("lap_duration"):
                    continue
                try:
                    ls = datetime.fromisoformat(lap["date_start"].replace("Z", "+00:00"))
                    le = ls + timedelta(seconds=float(lap["lap_duration"]) + 6)
                    lap_after  = ls.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                    lap_before = le.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                    chosen_driver = dn
                    break
                except Exception:
                    continue
            if lap_after:
                break

        # Pass 1b — practice laps with no duration: estimate from next lap's start
        if not lap_after:
            for dn, dlaps in driver_laps.items():
                for i, lap in enumerate(dlaps):
                    if not (3 <= (lap.get("lap_number") or 0) <= 8):
                        continue
                    if i + 1 >= len(dlaps):
                        continue
                    next_start = dlaps[i + 1].get("date_start")
                    if not next_start:
                        continue
                    try:
                        ls = datetime.fromisoformat(lap["date_start"].replace("Z", "+00:00"))
                        le = datetime.fromisoformat(next_start.replace("Z", "+00:00")) + timedelta(seconds=6)
                        lap_after  = ls.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                        lap_before = le.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                        chosen_driver = dn
                        break
                    except Exception:
                        continue
                if lap_after:
                    break

        # No lap window found: just pick any driver (still wide-window fetch below)
        if not chosen_driver:
            for l in laps_data:
                if l.get("driver_number") and l.get("date_start"):
                    chosen_driver = int(l["driver_number"])
                    break

    # ── Fetch: always wide window, single driver ──────────────────────────────
    data = await safe(of1.get_location(session_key, driver_number=chosen_driver,
                                        after=wide_after, before=wide_before))
    if not data:
        return []

    all_pts = sorted(data, key=lambda p: p.get("date", ""))

    # ── Slice to a single clean lap (if we have timestamps) ──────────────────
    if lap_after and lap_before:
        lap_pts = [p for p in all_pts if lap_after <= (p.get("date") or "") <= lap_before]
        if lap_pts:
            step = max(1, len(lap_pts) // 800)
            return lap_pts[::step]
        # Lap slice returned nothing (gap in data) — fall through to first-600 path

    # Fallback: take first ≤600 points (≈ one continuous lap at 4 Hz × 150 s).
    # Avoids cross-lap sampling artefacts on short circuits like Red Bull Ring.
    return all_pts[:600]


@router.get("/stints")
async def stints(session_key: int):
    return await of1.get_stints(session_key)


@router.get("/pit")
async def pit(session_key: int):
    return await of1.get_pit(session_key)


@router.get("/car_data/{driver_number}")
async def car_data(session_key: int, driver_number: int):
    data = await safe(of1.get_car_data(session_key, driver_number))
    if len(data) > 3000:
        step = len(data) // 3000
        data = data[::step]
    return data


@router.get("/team_radio")
async def team_radio(session_key: int):
    return await of1.get_team_radio(session_key)


@router.get("/team_radio/transcript")
async def team_radio_transcript(session_key: int, url: str = QParam(...)):
    """Transcribe a team-radio clip using local Whisper (result cached on disk).

    Returns {"text": "...", "ok": true} on success, {"text": "", "ok": false, "error": "..."}
    if Whisper is not installed or transcription fails.
    """
    try:
        from services.whisper_service import transcribe_url  # lazy import — only runs when called
        text = await transcribe_url(url)
        return {"text": text, "ok": True}
    except ImportError:
        return {
            "text": "",
            "ok": False,
            "error": "openai-whisper non installato. Esegui: pip install openai-whisper",
        }
    except Exception as exc:
        return {"text": "", "ok": False, "error": str(exc)}


@router.get("/weather")
async def weather(session_key: int):
    return await of1.get_weather(session_key)


@router.get("/race_control")
async def race_control(session_key: int):
    return await of1.get_race_control(session_key)


@router.get("/timing")
async def timing(session_key: int, before: str | None = None):
    """Aggregated timing snapshot. Pass `before=ISO_timestamp` to get race state at that moment."""
    # Cutoff for Python-side filtering of race-position records
    try:
        before_dt = datetime.fromisoformat(before.replace("Z", "+00:00")) if before else datetime.now(timezone.utc)
    except Exception:
        before_dt = datetime.now(timezone.utc)
    pos_before_str = before_dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")

    # Use the normalised string (no milliseconds, no Z suffix) for OpenF1 API calls.
    # The raw frontend ISO string ("…T14:30:00.000Z") can confuse OpenF1's date filter,
    # causing it to return ALL laps/intervals and making latest_laps show the race's
    # final state even when scrubbing the first half — the root cause of the sprint
    # "second half" data corruption bug.
    api_before = pos_before_str if before else None

    laps, intervals, stints, drivers, pos_data, pit_data = await asyncio.gather(
        # Laps: fetch ALL without a date filter — OpenF1's /laps uses `date_start`, not `date`,
        # so a `date<=` filter returns 0 results. Python-side guard below trims future laps.
        # Bonus: stable cache key per session (not per minute) → far fewer OpenF1 requests.
        safe(of1.get_laps(session_key)),
        safe(of1.get_intervals(session_key, before=api_before)),
        safe(of1.get_stints(session_key)),
        safe(of1.get_drivers(session_key)),
        safe(of1.get_positions(session_key)),  # all session standings — cached by session_key, filtered below
        safe(of1.get_pit(session_key)),
    )

    # Latest race standing position per driver, up to pos_before_str.
    # Fetching without a time window means the cache key is stable per session (not per scrubTime
    # bucket), so repeated timing requests hit the cache instead of re-fetching from OpenF1.
    latest_pos: dict[int, dict] = {}
    for p in pos_data:
        p_date = p.get("date", "")
        if not p_date or p_date > pos_before_str:
            continue
        dn = p.get("driver_number")
        if dn not in latest_pos or p_date > latest_pos[dn].get("date", ""):
            latest_pos[dn] = p

    # Python-side lap guard: even if OpenF1 ignores the before filter, skip laps
    # whose date_start is after pos_before_str (future laps at the current scrub position).
    latest_laps: dict[int, dict] = {}
    for lap in laps:
        lap_date = lap.get("date_start") or lap.get("date") or ""
        if api_before and lap_date and lap_date > pos_before_str:
            continue  # future lap — not yet reached at this scrub position
        dn = lap.get("driver_number")
        if dn not in latest_laps or lap.get("lap_number", 0) > latest_laps[dn].get("lap_number", 0):
            latest_laps[dn] = lap

    # Python-side interval guard: drop intervals timestamped after the scrub point.
    latest_int: dict[int, dict] = {}
    for iv in intervals:
        iv_date = iv.get("date", "")
        if api_before and iv_date and iv_date > pos_before_str:
            continue
        dn = iv.get("driver_number")
        if dn not in latest_int or iv_date > latest_int[dn].get("date", ""):
            latest_int[dn] = iv

    # Fill drivers with no lap data yet (DNS, lap-0 DNF, very early scrub).
    # Must happen HERE — before the retirement check — so that DNS/DNF-at-start
    # drivers (lap_number=None) are included in the retirement loop.
    for d in drivers:
        dn = d.get("driver_number")
        if dn and dn not in latest_laps:
            latest_laps[dn] = {
                "driver_number": dn,
                "position": None,
                "lap_number": None,
                "lap_duration": None,
                "duration_sector_1": None,
                "duration_sector_2": None,
                "duration_sector_3": None,
                "date_start": None,
            }

    # ── Retired drivers: lap-count heuristic (OpenF1 never emits "RETIRED" RC messages) ──
    #
    # A driver is considered retired when their last lap_number is ≥ 3 behind the
    # leader AND one of these gap conditions holds:
    #
    #   a) Gap is a frozen seconds value (e.g. "21.759") — car stopped on track.
    #   b) Gap shows "+N LAP(S)" / "+LN" but the driver's actual lap deficit is
    #      significantly greater than N — the gap string is STALE from when the
    #      driver retired while being lapped.
    #
    # Example of (b): driver retires at lap 31 while "+1 LAP" down; the leader
    # finishes at lap 57.  Gap stays frozen as "+1 LAP" but lap_diff = 26 ≫ 1.
    # Without this check those drivers were incorrectly treated as active lapped cars.
    #
    # The leader_lap >= 5 guard avoids false positives during rolling/formation laps.
    leader_lap = max((l.get("lap_number") or 0) for l in latest_laps.values()) if latest_laps else 0
    retired_drivers: set[int] = set()
    if leader_lap >= 5:
        for dn_r, lap_r in latest_laps.items():
            driver_lap = lap_r.get("lap_number") or 0
            lap_diff = leader_lap - driver_lap
            if lap_diff < 3:
                continue
            gap = str(latest_int.get(dn_r, {}).get("gap_to_leader") or "")
            gap_upper = gap.upper()
            if "LAP" in gap_upper or gap.startswith("+L"):
                # Gap claims the driver is N laps down — extract N.
                # If the actual lap_diff is much larger than N, the gap is stale
                # from when the driver retired while lapped → treat as retired.
                m = re.search(r"(\d+)", gap)
                claimed_laps = int(m.group(1)) if m else 1
                if lap_diff <= claimed_laps + 2:
                    continue  # genuinely lapped, still racing
                # else: lap_diff >> claimed_laps → stale gap, driver retired
            retired_drivers.add(dn_r)

    # ── Active pit stops: pit entry where scrub-time falls inside the stop window ──
    # pit["date"] = when the car arrived in the pit box.
    # pit["pit_duration"] = seconds spent (None while still in pit lane).
    pitting_drivers: set[int] = set()
    for pit in pit_data:
        pit_date = pit.get("date", "")
        if not pit_date:
            continue
        # Skip pit stops that haven't happened yet at the current scrub point
        if api_before and pit_date > pos_before_str:
            continue
        pit_dur = pit.get("pit_duration")
        if pit_dur is None:
            # Duration unknown → still in pit lane at this moment
            dn = pit.get("driver_number")
            if dn:
                pitting_drivers.add(dn)
        else:
            # Pit stop is complete: check if scrub_time < pit_end + 5s buffer
            try:
                pit_dt = datetime.fromisoformat(pit_date.replace("Z", "+00:00"))
                pit_end = pit_dt + timedelta(seconds=float(pit_dur) + 5)
                pit_end_str = pit_end.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
                if pos_before_str <= pit_end_str:
                    dn = pit.get("driver_number")
                    if dn:
                        pitting_drivers.add(dn)
            except Exception:
                pass

    current_stint: dict[int, dict] = {}
    for s in stints:
        dn = s.get("driver_number")
        lap_start = s.get("lap_start") or 0
        current_lap = latest_laps.get(dn, {}).get("lap_number") or 0
        # Keep stint active at this moment
        if s.get("lap_end") is None or s.get("lap_end", 0) >= current_lap:
            if dn not in current_stint or lap_start > (current_stint[dn].get("lap_start") or 0):
                current_stint[dn] = s

    driver_map = {d["driver_number"]: d for d in drivers}
    result = []
    for dn, lap in latest_laps.items():
        driver = driver_map.get(dn, {})
        iv = latest_int.get(dn, {})
        stint = current_stint.get(dn, {})
        result.append({
            "driver_number": dn,
            "abbreviation": driver.get("name_acronym", ""),
            "full_name": driver.get("full_name", ""),
            "team_name": driver.get("team_name", ""),
            "team_colour": driver.get("team_colour", "FFFFFF"),
            "headshot_url": driver.get("headshot_url", ""),
            "position": (latest_pos.get(dn) or {}).get("position") or lap.get("position"),
            "lap_number": lap.get("lap_number"),
            "lap_duration": lap.get("lap_duration"),
            "duration_sector_1": lap.get("duration_sector_1"),
            "duration_sector_2": lap.get("duration_sector_2"),
            "duration_sector_3": lap.get("duration_sector_3"),
            "gap_to_leader": iv.get("gap_to_leader"),
            "interval": iv.get("interval"),
            "compound": stint.get("compound"),
            "tyre_age_at_start": stint.get("tyre_age_at_start"),
            "lap_start": stint.get("lap_start"),
            "lap_date_start": lap.get("date_start"),  # used to pinpoint race end for map
            "is_retired": dn in retired_drivers,
            "is_pitting": dn in pitting_drivers,
        })

    result.sort(key=lambda x: (x.get("position") or 99))
    return result
