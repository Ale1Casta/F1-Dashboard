import type { StreamPosition } from "../types";

const BASE = "/api";

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

export const api = {
  meetings: (year: number) => get<any[]>(`/meetings?year=${year}`),
  sessions: (meetingKey: number) => get<any[]>(`/sessions?meeting_key=${meetingKey}`),
  latestSession: () => get<any>(`/sessions/latest`),
  drivers: (sk: number) => get<any[]>(`/sessions/${sk}/drivers`),
  timing: (sk: number, before?: string) =>
    get<any[]>(`/sessions/${sk}/timing${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  positions: (sk: number, before?: string) =>
    get<any[]>(`/sessions/${sk}/positions${before ? `?before=${encodeURIComponent(before)}` : ""}`),
  circuitOutline: (sk: number) => get<any[]>(`/sessions/${sk}/positions/circuit`),
  positionsStream: (sk: number, after: string, before: string) =>
    get<StreamPosition[]>(`/sessions/${sk}/positions/stream?after=${encodeURIComponent(after)}&before=${encodeURIComponent(before)}`),
  stints: (sk: number) => get<any[]>(`/sessions/${sk}/stints`),
  pit: (sk: number) => get<any[]>(`/sessions/${sk}/pit`),
  carData: (sk: number, dn: number) => get<any[]>(`/sessions/${sk}/car_data/${dn}`),
  teamRadio: (sk: number) => get<any[]>(`/sessions/${sk}/team_radio`),
  raceControl: (sk: number) => get<any[]>(`/sessions/${sk}/race_control`),
  laps: (sk: number, dn?: number) =>
    get<any[]>(`/sessions/${sk}/laps${dn ? `?driver_number=${dn}` : ""}`),
  weather: (sk: number) => get<any[]>(`/sessions/${sk}/weather`),
  transcript: (sk: number, url: string) =>
    get<{ text: string; ok: boolean; error?: string }>(
      `/sessions/${sk}/team_radio/transcript?url=${encodeURIComponent(url)}`
    ),

  // OpenF1 auth
  authStatus: () => get<{ auth_required: boolean; authenticated: boolean }>(`/auth/status`),
  authLogin: (username: string, password: string) =>
    fetch(`${BASE}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then((r) => r.json()) as Promise<{ ok: boolean; error: string | null }>,

  // Historical via FastF1
  schedule: (year: number) => get<any[]>(`/historical/schedule?year=${year}`),
  historicalLaps: (year: number, round: number, sessionType = "R") =>
    get<any[]>(`/historical/${year}/${round}/laps?session_type=${sessionType}`),
  driverLaps: (year: number, round: number, driver: string, sessionType = "R") =>
    get<any[]>(`/historical/${year}/${round}/laps/${driver}?session_type=${sessionType}`),
  telemetry: (year: number, round: number, driver: string, sessionType = "R", lap?: number) =>
    get<any>(`/historical/${year}/${round}/telemetry/${driver}?session_type=${sessionType}${lap ? `&lap=${lap}` : ""}`),
};
