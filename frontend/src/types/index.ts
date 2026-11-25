export interface Meeting {
  meeting_key: number;
  meeting_name: string;
  location: string;
  country_name: string;
  date_start: string;
  circuit_short_name: string;
}

export interface Session {
  session_key: number;
  session_name: string;
  session_type: string;
  date_start: string;
  date_end: string;
  meeting_key: number;
}

export interface Driver {
  driver_number: number;
  abbreviation: string;
  full_name: string;
  team_name: string;
  team_colour: string;
  headshot_url: string;
}

export interface TimingEntry {
  driver_number: number;
  abbreviation: string;
  full_name: string;
  team_name: string;
  team_colour: string;
  headshot_url: string;
  position: number | null;
  lap_number: number | null;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  gap_to_leader: string | number | null;
  interval: string | number | null;
  compound: string | null;
  tyre_age_at_start: number | null;
  lap_start: number | null;
  lap_date_start: string | null;
  is_retired?: boolean;
  is_pitting?: boolean;
}

export interface Position {
  driver_number: number;
  x: number;
  y: number;
  z: number;
  date: string;
}

/** Slim GPS point returned by /positions/stream — pre-computed ms timestamp,
 *  no ISO date string, no z/session_key/meeting_key overhead. */
export interface StreamPosition {
  driver_number: number;
  x: number;
  y: number;
  t: number; // Unix milliseconds
}

export interface Stint {
  driver_number: number;
  stint_number: number;
  lap_start: number;
  lap_end: number;
  compound: string;
  tyre_age_at_start: number;
}

export interface Pit {
  driver_number: number;
  lap_number: number;
  pit_duration: number;
  date: string;
}

export interface TeamRadio {
  driver_number: number;
  date: string;
  recording_url: string;
}

export interface RaceControlMessage {
  date: string;
  category: string;
  message: string;
  flag: string | null;
  scope: string | null;
  driver_number: number | null;
  lap_number: number | null;
}

export interface CarData {
  date: string;
  driver_number: number;
  speed: number;
  rpm: number;
  gear: number;
  throttle: number;
  brake: number;
  drs: number;
}

export interface WsPayload {
  type: string;
  timing: TimingEntry[];
  positions: Position[];
  race_control: RaceControlMessage[];
  weather: Record<string, unknown>;
}

export type TyreCompound = "SOFT" | "MEDIUM" | "HARD" | "INTERMEDIATE" | "WET" | "UNKNOWN";

export const TYRE_COLORS: Record<string, string> = {
  SOFT: "#FF3333",
  MEDIUM: "#FFD700",
  HARD: "#FFFFFF",
  INTERMEDIATE: "#39B54A",
  WET: "#0067FF",
  UNKNOWN: "#888888",
};

export interface WeatherPoint {
  date: string;
  air_temperature: number;
  track_temperature: number;
  humidity: number;
  wind_speed: number;
  wind_direction: number;
  rainfall: number;
}

export interface LapRecord {
  driver_number: number;
  lap_number: number;
  lap_duration: number | null;
  duration_sector_1: number | null;
  duration_sector_2: number | null;
  duration_sector_3: number | null;
  date_start: string | null;
}

export const PANEL_KEYS = [
  "timing", "trackmap", "strategy",
  "weather", "laptimes", "h2h",
  "radio", "gap", "racecontrol",
  "telemetry",
] as const;
export type PanelKey = typeof PANEL_KEYS[number];
