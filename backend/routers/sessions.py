from fastapi import APIRouter, HTTPException
from services import openf1_client as of1
from services import fastf1_service as ff1

router = APIRouter(tags=["sessions"])


@router.get("/meetings")
async def meetings(year: int = 2025):
    return await of1.get_meetings(year)


@router.get("/sessions")
async def sessions(meeting_key: int):
    return await of1.get_sessions(meeting_key)


@router.get("/sessions/latest")
async def latest_session():
    s = await of1.get_latest_session()
    if not s:
        raise HTTPException(404, "No active session")
    return s


@router.get("/sessions/{session_key}/drivers")
async def drivers(session_key: int):
    return await of1.get_drivers(session_key)


@router.get("/sessions/{session_key}/weather")
async def weather(session_key: int):
    return await of1.get_weather(session_key)


# --- FastF1 historical ---

@router.get("/historical/schedule")
def schedule(year: int = 2024):
    try:
        return ff1.get_event_schedule(year)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/historical/{year}/{round}/results")
def session_results(year: int, round: int, session_type: str = "R"):
    try:
        return ff1.get_session_results(year, round, session_type)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/historical/{year}/{round}/laps")
def all_laps(year: int, round: int, session_type: str = "R"):
    try:
        return ff1.get_all_driver_laps(year, round, session_type)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/historical/{year}/{round}/laps/{driver}")
def driver_laps(year: int, round: int, driver: str, session_type: str = "R"):
    try:
        return ff1.get_driver_laps(year, round, session_type, driver)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/historical/{year}/{round}/telemetry/{driver}")
def telemetry(year: int, round: int, driver: str, session_type: str = "R", lap: int | None = None):
    try:
        return ff1.get_driver_telemetry(year, round, session_type, driver, lap)
    except Exception as e:
        raise HTTPException(500, str(e))


@router.get("/historical/{year}/{round}/circuit")
def circuit(year: int, round: int):
    try:
        return ff1.get_circuit_info(year, round)
    except Exception as e:
        raise HTTPException(500, str(e))
