import asyncio
import json
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from services import openf1_client as of1


async def safe(coro):
    try:
        return await coro
    except Exception:
        return []

router = APIRouter(tags=["websocket"])

POLL_INTERVAL = 3  # seconds


@router.websocket("/ws/{session_key}")
async def live_feed(websocket: WebSocket, session_key: int):
    await websocket.accept()
    try:
        while True:
            # Fetch GPS locations for last 30s only — keeps data volume small
            now = datetime.now(timezone.utc)
            after_str = (now - timedelta(seconds=30)).strftime("%Y-%m-%dT%H:%M:%S")
            before_str = now.strftime("%Y-%m-%dT%H:%M:%S")

            timing, locations, race_control, weather_data = await asyncio.gather(
                safe(_get_timing(session_key)),
                safe(of1.get_location(session_key, before=before_str, after=after_str)),
                safe(of1.get_race_control(session_key)),
                safe(of1.get_weather(session_key)),
            )

            # Latest GPS fix per driver
            pos_map: dict[int, dict] = {}
            for p in locations:
                dn = p.get("driver_number")
                if dn not in pos_map or p.get("date", "") > pos_map[dn].get("date", ""):
                    pos_map[dn] = p

            payload = {
                "type": "update",
                "timing": timing,
                "positions": list(pos_map.values()),
                "race_control": race_control[-5:] if race_control else [],
                "weather": weather_data[-1] if weather_data else {},
            }
            await websocket.send_text(json.dumps(payload, default=str))
            await asyncio.sleep(POLL_INTERVAL)
    except WebSocketDisconnect:
        pass
    except Exception as e:
        try:
            await websocket.send_text(json.dumps({"type": "error", "message": str(e)}))
        except Exception:
            pass


async def _get_timing(session_key: int) -> list[dict]:
    laps, intervals, stints, drivers = await asyncio.gather(
        safe(of1.get_laps(session_key)),
        safe(of1.get_intervals(session_key)),
        safe(of1.get_stints(session_key)),
        safe(of1.get_drivers(session_key)),
    )
    latest_laps: dict[int, dict] = {}
    for lap in laps:
        dn = lap.get("driver_number")
        if dn not in latest_laps or lap.get("lap_number", 0) > latest_laps[dn].get("lap_number", 0):
            latest_laps[dn] = lap

    latest_int: dict[int, dict] = {}
    for iv in intervals:
        dn = iv.get("driver_number")
        if dn not in latest_int or iv["date"] > latest_int[dn]["date"]:
            latest_int[dn] = iv

    current_stint: dict[int, dict] = {}
    for s in stints:
        dn = s.get("driver_number")
        if dn not in current_stint or s.get("stint_number", 0) > current_stint[dn].get("stint_number", 0):
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
            "position": lap.get("position"),
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
        })

    result.sort(key=lambda x: (x.get("position") or 99))
    return result
