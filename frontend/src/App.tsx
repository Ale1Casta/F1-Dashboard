import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useQuery, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import SessionSelector from "./components/SessionSelector/SessionSelector";
import TimingTower from "./components/TimingTower/TimingTower";
import TrackMap from "./components/TrackMap/TrackMap";
import TireStrategy from "./components/TireStrategy/TireStrategy";
import WeatherPanel from "./components/WeatherPanel/WeatherPanel";
import LapChart from "./components/LapChart/LapChart";
import HeadToHead from "./components/HeadToHead/HeadToHead";
import TeamRadio from "./components/TeamRadio/TeamRadio";
import GapChart from "./components/GapChart/GapChart";
import RaceControl from "./components/RaceControl/RaceControl";
import RaceScrubber from "./components/RaceScrubber/RaceScrubber";
import Telemetry from "./components/Telemetry/Telemetry";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { useWebSocket } from "./hooks/useWebSocket";
import { api } from "./api/client";
import type { PanelKey, TimingEntry, Position, StreamPosition, WeatherPoint, LapRecord } from "./types";
import { PANEL_KEYS } from "./types";
import styles from "./App.module.css";

// ── OpenF1 login panel — shown only when the API requires authentication ──────
function OpenF1LoginPanel({ onLogin }: { onLogin: () => void }) {
  const { data: status, isLoading } = useQuery({
    queryKey: ["auth-status"],
    queryFn:  () => api.authStatus(),
    // Poll every 30 s so the panel disappears automatically if auth is obtained
    // externally (e.g. via .env) without a page reload.
    refetchInterval: 30_000,
    staleTime: 10_000,
  });

  const [user, setUser]   = useState("");
  const [pass, setPass]   = useState("");
  const [busy, setBusy]   = useState(false);
  const [err,  setErr]    = useState<string | null>(null);
  const [ok,   setOk]     = useState(false);
  const qc = useQueryClient();

  // Don't render at all while checking, or when auth is not needed, or already done
  if (isLoading || !status?.auth_required || status?.authenticated || ok) return null;

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await api.authLogin(user.trim(), pass);
      if (res.ok) {
        setOk(true);
        qc.invalidateQueries({ queryKey: ["auth-status"] });
        onLogin();
      } else {
        setErr(res.error ?? "Accesso negato");
      }
    } catch {
      setErr("Errore di connessione al backend");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{
      marginTop: 28,
      padding: "20px 24px",
      background: "var(--bg2)",
      border: "1px solid var(--border)",
      borderRadius: 10,
      maxWidth: 340,
      width: "100%",
      textAlign: "left",
    }}>
      <p style={{ fontSize: 12, fontWeight: 600, color: "var(--text2)", marginBottom: 4 }}>
        Accesso OpenF1 richiesto
      </p>
      <p style={{ fontSize: 11, color: "var(--text3)", marginBottom: 16, lineHeight: 1.5 }}>
        I dati live richiedono un account OpenF1.{" "}
        <a href="https://openf1.org/auth.html" target="_blank" rel="noreferrer"
           style={{ color: "var(--accent)", textDecoration: "none" }}>
          Registrati →
        </a>
      </p>
      <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <input
          type="email"
          placeholder="Email"
          autoComplete="username"
          value={user}
          onChange={e => setUser(e.target.value)}
          required
          style={{
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "7px 10px", color: "var(--text)",
            fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box",
          }}
        />
        <input
          type="password"
          placeholder="Password"
          autoComplete="current-password"
          value={pass}
          onChange={e => setPass(e.target.value)}
          required
          style={{
            background: "var(--bg3)", border: "1px solid var(--border)",
            borderRadius: 6, padding: "7px 10px", color: "var(--text)",
            fontSize: 12, outline: "none", width: "100%", boxSizing: "border-box",
          }}
        />
        {err && (
          <p style={{ fontSize: 11, color: "#ff6b6b", margin: 0 }}>{err}</p>
        )}
        <button
          type="submit"
          disabled={busy || !user || !pass}
          style={{
            background: busy ? "var(--bg3)" : "var(--accent)",
            color: "#fff", border: "none", borderRadius: 6,
            padding: "8px 0", fontSize: 12, fontWeight: 600,
            cursor: busy ? "default" : "pointer",
            opacity: (!user || !pass) ? 0.5 : 1,
            transition: "opacity 0.15s",
          }}
        >
          {busy ? "Accesso in corso…" : "Accedi"}
        </button>
      </form>
    </div>
  );
}

const PANEL_LABELS: Record<PanelKey, string> = {
  timing:    "Timing Tower",
  trackmap:  "Mappa Pista",
  strategy:  "Strategia",
  weather:   "Meteo",
  laptimes:  "Storico Giri",
  h2h:       "Confronto Piloti",
  radio:     "Team Radio",
  gap:       "Gap Chart",
  racecontrol: "Race Control",
  telemetry: "Telemetria",
};

/** OpenF1 session_type → FastF1 short code */
const OF1_TO_FF1: Record<string, string> = {
  "Race": "R", "Qualifying": "Q",
  "Practice 1": "FP1", "Practice 2": "FP2", "Practice 3": "FP3",
  "Sprint": "S", "Sprint Qualifying": "SQ", "Sprint Shootout": "SQ",
};

const DEFAULT_VISIBLE: PanelKey[] = ["timing", "trackmap", "strategy", "racecontrol"];

/** Stable module-level helper — never changes reference, safe in useMemo deps */
const getMsgTs = (m: any) => (m?.date ? new Date(m.date).getTime() : Infinity);

interface GapSnap { lap: number; gaps: Record<number, number> }

function parseGapSec(g: unknown): number | null {
  if (g == null) return null;
  if (typeof g === "number") return g;
  const s = String(g);
  if (!s || s.startsWith("+L")) return null;
  return parseFloat(s.replace("+", "")) || null;
}

export default function App() {
  const queryClient = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [meetingKey, setMeetingKey] = useState<number | null>(null);
  const [sessionKey, setSessionKey] = useState<number | null>(null);
  const [sessionInfo, setSessionInfo] = useState<any>(null);
  const [isLive, setIsLive] = useState(false);
  const [visible, setVisible] = useState<Set<PanelKey>>(new Set(DEFAULT_VISIBLE));
  const [gapHistory, setGapHistory] = useState<GapSnap[]>([]);
  const [scrubTime, setScrubTime] = useState<Date | null>(null); // null = live/latest
  const [playSpeed, setPlaySpeed] = useState<1 | 5 | 15 | 30>(15);
  const [isPlaying, setIsPlaying] = useState(false);
  const lastLapRef = useRef<number | null>(null);
  // Prevents the auto-start effect from re-running when `sessions` gets a new reference
  const scrubInitializedForRef = useRef<number | null>(null);
  // Prevents auto-live from re-triggering after the user manually disables it
  const autoLiveEnabledForRef = useRef<number | null>(null);

  // Reset scrub + gap history when session changes
  useEffect(() => {
    setScrubTime(null);
    setGapHistory([]);
    lastLapRef.current = null;
    scrubInitializedForRef.current = null; // allow auto-start for the new session
  }, [sessionKey]);

  // Auto-live detection: true when the selected session window contains "now"
  const isSessionCurrentlyLive = useMemo(() => {
    if (!sessionInfo?.date_start) return false;
    const now = Date.now();
    const start = new Date(sessionInfo.date_start).getTime();
    // Use date_end + 30 min buffer; fall back to start + 3 h if date_end absent
    const end = sessionInfo.date_end
      ? new Date(sessionInfo.date_end).getTime() + 30 * 60 * 1000
      : start + 3 * 60 * 60 * 1000;
    return now >= start && now <= end;
  }, [sessionInfo]);

  // When a session is selected and it's currently live, auto-enable live mode once.
  // Guard prevents re-firing if the user later manually disables live.
  useEffect(() => {
    if (!sessionKey || !isSessionCurrentlyLive) return;
    if (autoLiveEnabledForRef.current === sessionKey) return;
    autoLiveEnabledForRef.current = sessionKey;
    setIsLive(true);
    setScrubTime(null); // ensure live view, not scrub
  }, [sessionKey, isSessionCurrentlyLive]);

  // Snap scrubTime to 60-second buckets for timing queries (reduces cache churn at play speeds)
  const TIMING_SNAP_MS = 60_000;
  const POS_SNAP_MS    = 30_000;

  // ── Adaptive stream bucket ────────────────────────────────────────────────
  // At x30 a fixed 60s bucket changes every 2 real seconds but fetches take
  // ~1.5 s — the data always arrives AFTER the next bucket is needed.
  // Rule: STREAM_BUCKET_MS must be large enough that one bucket covers at least
  // 4 real seconds at the current speed  →  STREAM_BUCKET_MS ≥ speed × 4000 ms.
  //   x1–x14 : 60 000 ms  (bucket every ≥60 real s — well within limits)
  //   x15    : 60 000 ms  (bucket every  4 real s)
  //   x30    : 120 000 ms (bucket every  4 real s)
  const STREAM_BUCKET_MS = Math.max(60_000, playSpeed * 4_000);

  // Window = bucket + 120s fixed buffer so the current bucket always holds
  // enough data to last until the *next* bucket arrives.
  // Payload stays bounded: MAX_PER_DRIVER=300 caps points regardless of window.
  const STREAM_WINDOW_MS = STREAM_BUCKET_MS + 120_000;

  // Offset is FIXED at 30 000 ms (half a 60s base-bucket), independent of the
  // adaptive bucket size.  This guarantees stream and timing never fire at the
  // same real-clock instant at any supported speed:
  //   x15: timing every 4s (at :00/:04/…), stream every 4s (at :02/:06/…) → 2s apart ✓
  //   x30: timing every 2s (at :00/:02/…), stream every 4s (at :01/:05/…) → 1s apart ✓
  const STREAM_OFFSET_MS = 30_000;

  const beforeStr = scrubTime
    ? new Date(Math.floor(scrubTime.getTime() / TIMING_SNAP_MS) * TIMING_SNAP_MS).toISOString()
    : undefined;

  const streamBucketStart = scrubTime
    ? new Date(Math.floor((scrubTime.getTime() - STREAM_OFFSET_MS) / STREAM_BUCKET_MS) * STREAM_BUCKET_MS + STREAM_OFFSET_MS)
    : null;
  const streamBucketEnd = streamBucketStart
    ? new Date(streamBucketStart.getTime() + STREAM_WINDOW_MS)
    : null;

  // Live WS (only active when live mode and no scrub)
  const { data: wsData, connected } = useWebSocket(
    isLive && !scrubTime ? sessionKey : null
  );

  // Timing (REST) — must come before positionsBefore which depends on it
  const { data: timingRest = [] } = useQuery({
    queryKey: ["timing", sessionKey, beforeStr],
    queryFn: () => api.timing(sessionKey!, beforeStr),
    enabled: !!sessionKey && (!isLive || !!scrubTime),
    refetchInterval: !scrubTime && !isLive ? 5000 : false,
    placeholderData: keepPreviousData,
    // Old timing buckets are never needed again once scrubTime advances — evict quickly
    gcTime: 60_000,
  });

  // Derive position reference time from timing data so the 30s window lands on actual
  // race data — not on the session's planned date_end which can be far after the finish.
  const positionsBefore = (() => {
    if (scrubTime) return new Date(Math.floor(scrubTime.getTime() / POS_SNAP_MS) * POS_SNAP_MS).toISOString();
    if (isLive) return undefined;
    const leader = timingRest[0];
    if (leader?.lap_date_start && leader?.lap_duration) {
      const lapEnd = new Date(leader.lap_date_start).getTime()
        + (leader.lap_duration as number) * 1000
        + 60_000;
      return new Date(lapEnd).toISOString();
    }
    return sessionInfo?.date_end ?? undefined;
  })();

  // Positions (REST) — only used in live/static mode; the stream replaces it when scrubbing
  const { data: positionsRest = [] } = useQuery({
    queryKey: ["positions", sessionKey, positionsBefore],
    queryFn: () => api.positions(sessionKey!, positionsBefore),
    enabled: !!sessionKey && !scrubTime && (!isLive || !!scrubTime) && (isLive || !!positionsBefore),
    refetchInterval: !isLive ? 15000 : false,
    placeholderData: keepPreviousData,
  });

  // Position stream for scrub mode — all GPS points in the current 90-second window.
  // These are used by TrackMap for accurate timestamp-based animation (no off-track shortcuts).
  const { data: positionStream = [] } = useQuery<StreamPosition[]>({
    queryKey: ["pos-stream", sessionKey, streamBucketStart?.toISOString()],
    queryFn: () => api.positionsStream(
      sessionKey!,
      streamBucketStart!.toISOString(),
      streamBucketEnd!.toISOString(),
    ),
    enabled: !!sessionKey && !!scrubTime && !!streamBucketStart,
    staleTime: Infinity,          // historical GPS data never changes
    // Keep the last 6 buckets alive in cache (gcTime = 3 × STREAM_BUCKET_MS in ms).
    // At x30 (bucket = 120 s): 6 buckets = 720 real-seconds of back/forward seeking
    // before a re-fetch is needed.  Memory: 6 × ~600 KB = ~3.6 MB — well within budget.
    // Without this, seeking back even 5 s could miss the cache and wait 2 s for OpenF1.
    gcTime: Math.max(180_000, STREAM_BUCKET_MS * 3),
    placeholderData: keepPreviousData,
  });

  // ── Prefetch next 2 GPS buckets during playback ────────────────────────────
  // Fires whenever the current bucket changes (streamBucketStart) and we're playing.
  // Loads the next buckets into React Query cache BEFORE scrubTime reaches them,
  // making sequential playback seamless (cache hit instead of 2 s OpenF1 fetch).
  useEffect(() => {
    if (!isPlaying || !sessionKey || !streamBucketStart) return;
    // Re-derive bucket sizes inside the effect (depends on playSpeed, not state directly)
    const bucketMs = Math.max(60_000, playSpeed * 4_000);
    const windowMs = bucketMs + 120_000;
    for (let i = 1; i <= 2; i++) {
      const nextStart = new Date(streamBucketStart.getTime() + i * bucketMs);
      const nextEnd   = new Date(nextStart.getTime() + windowMs);
      queryClient.prefetchQuery({
        queryKey: ["pos-stream", sessionKey, nextStart.toISOString()],
        queryFn: () => api.positionsStream(sessionKey!, nextStart.toISOString(), nextEnd.toISOString()),
        staleTime: Infinity,
      });
    }
  }, [streamBucketStart, isPlaying, sessionKey, playSpeed, queryClient]);

  // Track outline (bounded 12-min window, ~1500 records max)
  const { data: trackHistory = [] } = useQuery<Position[]>({
    queryKey: ["track-history", sessionKey],
    queryFn: () => api.circuitOutline(sessionKey!) as Promise<Position[]>,
    enabled: !!sessionKey,
    staleTime: Infinity,
    retry: 2,
  });

  // Static data (loaded once, no scrub needed)
  const { data: stints = [] } = useQuery({
    queryKey: ["stints", sessionKey],
    queryFn: () => api.stints(sessionKey!),
    enabled: !!sessionKey,
    // Historical data never changes — only poll during live playback
    refetchInterval: isLive && !scrubTime ? 30000 : false,
  });

  const { data: radioMessages = [] } = useQuery({
    queryKey: ["radio", sessionKey],
    queryFn: () => api.teamRadio(sessionKey!),
    enabled: !!sessionKey && visible.has("radio"),
    refetchInterval: isLive && !scrubTime ? 20000 : false,
  });

  const { data: rcMessages = [] } = useQuery({
    queryKey: ["rc", sessionKey],
    queryFn: () => api.raceControl(sessionKey!),
    enabled: !!sessionKey,
    refetchInterval: isLive && !scrubTime ? 15000 : false,
  });

  const { data: weatherData = [] } = useQuery<WeatherPoint[]>({
    queryKey: ["weather", sessionKey],
    queryFn: () => api.weather(sessionKey!) as Promise<WeatherPoint[]>,
    enabled: !!sessionKey && visible.has("weather"),
    staleTime: 60_000,
    refetchInterval: isLive && !scrubTime ? 60000 : false,
  });

  const { data: allLaps = [] } = useQuery<LapRecord[]>({
    queryKey: ["laps", sessionKey],
    queryFn: () => api.laps(sessionKey!) as Promise<LapRecord[]>,
    enabled: !!sessionKey && (visible.has("laptimes") || visible.has("h2h")),
    staleTime: Infinity,
    refetchInterval: isLive && !scrubTime ? 30000 : false,
  });

  // Meetings — same queryKey as SessionSelector so the cache is shared (no extra request)
  const { data: meetings = [] } = useQuery({
    queryKey: ["meetings", year],
    queryFn: () => api.meetings(year),
    staleTime: Infinity,
  });

  // FastF1 schedule — needed to derive round number for telemetry (no OpenF1 auth required)
  const { data: ff1Schedule = [] } = useQuery({
    queryKey: ["ff1-schedule", year],
    queryFn: () => api.schedule(year),
    staleTime: Infinity,
    enabled: !!year,
  });

  // Round number for the current meeting (matched by EventName or Location)
  const ff1Round = useMemo(() => {
    if (!meetingKey || !meetings.length || !ff1Schedule.length) return undefined;
    const meeting = (meetings as any[]).find((m) => m.meeting_key === meetingKey);
    if (!meeting) return undefined;
    const match = (ff1Schedule as any[]).find(
      (s) => s.EventName === meeting.meeting_name || s.Location === meeting.location
    );
    return match?.RoundNumber as number | undefined;
  }, [meetingKey, meetings, ff1Schedule]);

  // FastF1 session type short code derived from the selected session
  const ff1SessionType = useMemo(
    () => sessionInfo?.session_type ? (OF1_TO_FF1[sessionInfo.session_type] ?? undefined) : undefined,
    [sessionInfo]
  );

  // Session info for scrubber (start/end times)
  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions", meetingKey],   // same key as SessionSelector — shared cache
    queryFn: () => api.sessions(meetingKey!),
    enabled: !!meetingKey,
    staleTime: Infinity,
  });

  // Keep sessionInfo in sync whenever sessions data arrives or refreshes
  useEffect(() => {
    if (!sessionKey || !sessions.length) return;
    const s = sessions.find((s: any) => s.session_key === sessionKey);
    if (s) setSessionInfo(s);
  }, [sessionKey, sessions]);

  // Auto-start from session beginning — runs once per session selection.
  // Guarded by a ref so it does NOT re-fire when React Query creates a new `sessions`
  // array reference (which would reset scrubTime mid-playback and look like a freeze).
  useEffect(() => {
    if (!sessionKey || isLive || !sessions.length) return;
    if (scrubInitializedForRef.current === sessionKey) return; // already done for this session
    const s = sessions.find((s: any) => s.session_key === sessionKey);
    if (!s?.date_start) return;
    scrubInitializedForRef.current = sessionKey;
    setScrubTime(new Date(s.date_start));
  }, [sessionKey, sessions, isLive]);

  // Merge live WS data with REST data — always arrays, never undefined
  const timing: TimingEntry[] = (isLive && !scrubTime && wsData ? wsData.timing : timingRest) ?? [];
  const positions: Position[] = (isLive && !scrubTime && wsData ? wsData.positions : positionsRest) ?? [];
  const raceControl: any[] = (isLive && !scrubTime && wsData ? wsData.race_control : rcMessages) ?? [];

  // Accumulate gap history (only in live/polling mode)
  const updateGaps = useCallback((t: TimingEntry[]) => {
    if (!t.length || scrubTime) return;
    const lap = t[0]?.lap_number;
    if (lap == null || lap === lastLapRef.current) return;
    lastLapRef.current = lap;
    const gaps: Record<number, number> = {};
    t.forEach((e) => { const g = parseGapSec(e.gap_to_leader); if (g !== null) gaps[e.driver_number] = g; });
    setGapHistory((h) => [...h.slice(-80), { lap, gaps }]);
  }, [scrubTime]);

  useEffect(() => { updateGaps(timing); }, [timing, updateGaps]);

  const fastestLap = useMemo(() =>
    timing.reduce<number | null>((best, t) => {
      if (t.lap_duration == null) return best;
      return best == null || t.lap_duration < best ? t.lap_duration : best;
    }, null),
  [timing]);

  // Safe totalLaps — stints might be empty early on
  const totalLaps = useMemo(() => {
    const lapEnd = stints.length ? Math.max(...stints.map((s: any) => s.lap_end ?? 0)) : 0;
    return lapEnd > 0 ? lapEnd : 60;
  }, [stints]);
  const currentLap = timing[0]?.lap_number ?? null;

  // ── Position-change tracking for Timing Tower overtake arrows ───────────────
  // Stores the position each driver held in the previous timing snapshot.
  // Updated on every timing change; the delta is passed to TimingTower.
  const prevPositionsRef = useRef<Map<number, number>>(new Map());
  const positionDeltaRef = useRef<Map<number, number>>(new Map());  // positive = gained, negative = lost

  useEffect(() => {
    const prev = prevPositionsRef.current;
    const delta = new Map<number, number>();
    timing.forEach((t) => {
      if (t.position == null) return;
      const old = prev.get(t.driver_number);
      if (old != null && old !== t.position) {
        delta.set(t.driver_number, old - t.position); // positive = moved up (lower number)
      }
    });
    positionDeltaRef.current = delta;
    // Update snapshot: only store drivers with known positions
    const next = new Map<number, number>();
    timing.forEach((t) => { if (t.position != null) next.set(t.driver_number, t.position); });
    prevPositionsRef.current = next;
  }, [timing]);

  const scrubMs = scrubTime?.getTime() ?? null;

  // ── Stable filtered-message arrays ───────────────────────────────────────────
  // Problem: scrubMs changes every second → a simple filter memo would create a new
  // array reference every second → TeamRadio / RaceControl re-render every second.
  //
  // Fix: split into two stages.
  //   Stage 1 – pre-sort once (only when source data changes).
  //   Stage 2 – count visible messages (cheap number; busts every second but returns
  //             a primitive so downstream memos can compare cheaply).
  //   Stage 3 – slice the pre-sorted array (only busts when count changes, i.e. when
  //             scrubTime crosses a new message boundary — which is rare).
  //
  // Result: TeamRadio / RaceControl only re-render when a new message actually appears.

  const sortedRadioAsc = useMemo(
    () => [...(radioMessages ?? [])].sort((a, b) => getMsgTs(a) - getMsgTs(b)),
    [radioMessages]
  );
  const sortedRCAsc = useMemo(
    () => [...raceControl].sort((a, b) => getMsgTs(a) - getMsgTs(b)),
    [raceControl]
  );

  // Early-exit loop: O(visible) not O(all) since input is sorted ascending
  const visibleRadioCount = useMemo(() => {
    if (scrubMs == null) return sortedRadioAsc.length;
    let n = 0;
    for (const m of sortedRadioAsc) { if (getMsgTs(m) > scrubMs) break; n++; }
    return n;
  }, [sortedRadioAsc, scrubMs]);

  const visibleRCCount = useMemo(() => {
    if (scrubMs == null) return sortedRCAsc.length;
    let n = 0;
    for (const m of sortedRCAsc) { if (getMsgTs(m) > scrubMs) break; n++; }
    return n;
  }, [sortedRCAsc, scrubMs]);

  // Stable array reference — only changes when a new message becomes visible
  const filteredRadio = useMemo(
    () => sortedRadioAsc.slice(0, visibleRadioCount),
    [sortedRadioAsc, visibleRadioCount]
  );
  const filteredRC = useMemo(
    () => sortedRCAsc.slice(0, visibleRCCount),
    [sortedRCAsc, visibleRCCount]
  );

  const togglePanel = useCallback((key: PanelKey) => {
    setVisible((prev) => { const n = new Set(prev); n.has(key) ? n.delete(key) : n.add(key); return n; });
  }, []);

  const visibleList = PANEL_KEYS.filter((k) => visible.has(k));
  const colCount = Math.min(visibleList.length, 3);

  return (
    <div className={styles.root}>
      <SessionSelector
        year={year}
        onYearChange={setYear}
        meetingKey={meetingKey}
        onMeetingChange={(k) => { setMeetingKey(k); setSessionKey(null); setSessionInfo(null); }}
        sessionKey={sessionKey}
        onSessionChange={setSessionKey}
        isLive={isLive}
        onLiveToggle={() => setIsLive((v) => !v)}
        connected={connected}
        liveNow={isSessionCurrentlyLive}
      />

      <div className={styles.panelBar}>
        {PANEL_KEYS.map((key) => (
          <button
            key={key}
            className={`${styles.toggle} ${visible.has(key) ? styles.toggleActive : ""}`}
            onClick={() => togglePanel(key)}
          >
            {PANEL_LABELS[key]}
          </button>
        ))}
      </div>

      {!sessionKey ? (
        <div className={styles.empty}>
          <div className={styles.emptyInner}>
            <span className={styles.emptyTitle}>F1 Dashboard</span>
            <p>Seleziona anno, Gran Premio e sessione in alto per caricare i dati.</p>
            <p style={{ marginTop: 12, fontSize: 11, color: "var(--text3)", lineHeight: 1.7 }}>
              Una volta caricata la sessione, usa la barra in fondo alla pagina:<br />
              premi <span style={{ color: "var(--accent)", fontWeight: 700 }}>▶</span> per rivivere la gara in tempo reale,
              trascina il cursore per saltare a qualsiasi momento,
              e regola la velocità di riproduzione con i moltiplicatori 1× – 30×.
            </p>
            <OpenF1LoginPanel onLogin={() => queryClient.invalidateQueries({ queryKey: ["meetings"] })} />
          </div>
        </div>
      ) : (
        <>
          <ErrorBoundary>
          <div
            className={styles.grid}
            style={{ "--cols": colCount } as React.CSSProperties}
          >
            {visible.has("timing") && (
              <div style={{ gridRow: "span 2", minHeight: 0, height: "100%" }}>
                <ErrorBoundary>
                  <TimingTower
                    entries={timing}
                    fastestLap={fastestLap}
                    positionDelta={positionDeltaRef.current}
                  />
                </ErrorBoundary>
              </div>
            )}
            {visible.has("trackmap") && (
              <ErrorBoundary><TrackMap
                positions={positions}
                timing={timing}
                trackPoints={trackHistory}
                playSpeed={playSpeed}
                isPlaying={isPlaying}
                positionStream={scrubTime ? positionStream : undefined}
                scrubTime={scrubTime}
              /></ErrorBoundary>
            )}
            {visible.has("strategy") && (
              <ErrorBoundary><TireStrategy stints={stints} timing={timing} totalLaps={totalLaps} /></ErrorBoundary>
            )}
            {visible.has("weather") && (
              <ErrorBoundary>
                <WeatherPanel data={weatherData} scrubTime={scrubTime} />
              </ErrorBoundary>
            )}
            {visible.has("laptimes") && (
              <ErrorBoundary>
                <LapChart laps={allLaps} timing={timing} scrubTime={scrubTime} />
              </ErrorBoundary>
            )}
            {visible.has("h2h") && (
              <ErrorBoundary>
                <HeadToHead timing={timing} laps={allLaps} scrubTime={scrubTime} />
              </ErrorBoundary>
            )}
            {visible.has("radio") && (
              <ErrorBoundary>
                <TeamRadio messages={filteredRadio} timing={timing} sessionKey={sessionKey} />
              </ErrorBoundary>
            )}
            {visible.has("gap") && (
              <ErrorBoundary><GapChart timing={timing} history={gapHistory} /></ErrorBoundary>
            )}
            {visible.has("racecontrol") && (
              <ErrorBoundary><RaceControl messages={filteredRC} /></ErrorBoundary>
            )}
            {visible.has("telemetry") && (
              <div style={{ gridRow: "span 2", minHeight: 0, height: "100%" }}>
                <ErrorBoundary>
                  <Telemetry
                    sessionKey={sessionKey}
                    timing={timing}
                    year={year}
                    round={ff1Round}
                    sessionType={ff1SessionType}
                  />
                </ErrorBoundary>
              </div>
            )}
          </div>
          </ErrorBoundary>

          {/* Timeline scrubber — always shown when session is selected */}
          <ErrorBoundary>
            <RaceScrubber
              sessionStart={sessionInfo?.date_start ?? null}
              sessionEnd={sessionInfo?.date_end ?? null}
              scrubTime={scrubTime}
              onScrubChange={setScrubTime}
              raceControl={rcMessages}
              currentLap={currentLap}
              totalLaps={totalLaps}
              isLive={isLive}
              speed={playSpeed}
              onSpeedChange={setPlaySpeed}
              isPlaying={isPlaying}
              onPlayingChange={setIsPlaying}
            />
          </ErrorBoundary>
        </>
      )}
    </div>
  );
}
