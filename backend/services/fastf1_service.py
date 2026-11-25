import fastf1
import pandas as pd
from pathlib import Path

CACHE_DIR = Path(__file__).parent.parent / "cache" / "fastf1"
CACHE_DIR.mkdir(parents=True, exist_ok=True)
fastf1.Cache.enable_cache(str(CACHE_DIR))

SESSION_TYPE_MAP = {
    "FP1": "Practice 1",
    "FP2": "Practice 2",
    "FP3": "Practice 3",
    "Q": "Qualifying",
    "SQ": "Sprint Qualifying",
    "S": "Sprint",
    "R": "Race",
}


def _load_session(year: int, round_number: int, session_type: str) -> fastf1.core.Session:
    label = SESSION_TYPE_MAP.get(session_type, session_type)
    session = fastf1.get_session(year, round_number, label)
    session.load()
    return session


def get_event_schedule(year: int) -> list[dict]:
    schedule = fastf1.get_event_schedule(year, include_testing=False)
    return schedule[["RoundNumber", "EventName", "Location", "Country", "EventDate", "EventFormat"]].to_dict("records")


def get_session_results(year: int, round_number: int, session_type: str) -> list[dict]:
    session = _load_session(year, round_number, session_type)
    results = session.results
    cols = [c for c in ["Position", "DriverNumber", "Abbreviation", "FullName", "TeamName", "Points", "Time", "Status"] if c in results.columns]
    return results[cols].to_dict("records")


def get_driver_telemetry(year: int, round_number: int, session_type: str, driver: str, lap_number: int | None = None) -> dict:
    session = _load_session(year, round_number, session_type)
    if lap_number is not None:
        laps = session.laps.pick_driver(driver)
        lap = laps[laps["LapNumber"] == lap_number].iloc[0]
    else:
        lap = session.laps.pick_driver(driver).pick_fastest()

    tel = lap.get_telemetry()
    tel = tel[["Distance", "Speed", "Throttle", "Brake", "nGear", "RPM", "DRS", "X", "Y"]].dropna()
    # Downsample to max 2000 points to keep payload manageable
    if len(tel) > 2000:
        tel = tel.iloc[::len(tel) // 2000]
    return {
        "lap_number": int(lap["LapNumber"]),
        "lap_time": str(lap["LapTime"]),
        "data": tel.to_dict("records"),
    }


def get_driver_laps(year: int, round_number: int, session_type: str, driver: str) -> list[dict]:
    session = _load_session(year, round_number, session_type)
    laps = session.laps.pick_driver(driver)
    cols = [c for c in ["LapNumber", "LapTime", "Sector1Time", "Sector2Time", "Sector3Time", "Compound", "TyreLife", "FreshTyre", "PitInTime", "PitOutTime", "SpeedI1", "SpeedI2", "SpeedFL", "SpeedST"] if c in laps.columns]
    return laps[cols].to_dict("records")


def get_circuit_info(year: int, round_number: int) -> dict:
    session = fastf1.get_session(year, round_number, "Race")
    session.load(telemetry=False, weather=False, messages=False)
    circuit = session.get_circuit_info()
    return {
        "corners": circuit.corners[["Number", "Letter", "X", "Y", "Angle", "Distance"]].to_dict("records"),
        "marshal_lights": circuit.marshal_lights[["Number", "X", "Y", "Distance"]].to_dict("records") if hasattr(circuit, "marshal_lights") else [],
    }


def get_all_driver_laps(year: int, round_number: int, session_type: str) -> list[dict]:
    session = _load_session(year, round_number, session_type)
    laps = session.laps
    cols = [c for c in ["LapNumber", "LapTime", "Driver", "DriverNumber", "Team", "Compound", "TyreLife", "FreshTyre", "PitInTime", "PitOutTime", "Position"] if c in laps.columns]
    records = laps[cols].to_dict("records")
    # Convert Timedelta to string
    for r in records:
        for k, v in r.items():
            if isinstance(v, pd.Timedelta):
                r[k] = str(v) if pd.notna(v) else None
    return records
