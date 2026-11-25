import { useCallback, useEffect, useRef, useState } from "react"; // useState kept for hoverFrac
import { Play, Pause } from "lucide-react";
import type { RaceControlMessage } from "../../types";
import styles from "./RaceScrubber.module.css";

interface Props {
  sessionStart: string | null | undefined;
  sessionEnd: string | null | undefined;
  scrubTime: Date | null;
  onScrubChange: (t: Date | null) => void;
  raceControl: RaceControlMessage[];
  currentLap: number | null;
  totalLaps: number | null;
  isLive: boolean;
  speed: typeof SPEEDS[number];
  onSpeedChange: (s: typeof SPEEDS[number]) => void;
  isPlaying: boolean;
  onPlayingChange: (p: boolean) => void;
}

const FLAG_COLORS: Record<string, string> = {
  GREEN: "#39b54a",
  YELLOW: "#ffd700",
  DOUBLE_YELLOW: "#ffd700",
  RED: "#e10600",
  SAFETY_CAR: "#ffd700",
  VIRTUAL_SAFETY_CAR: "#ffd700",
  BLUE: "#0067ff",
};
const FLAG_ABBR: Record<string, string> = {
  SAFETY_CAR: "SC",
  VIRTUAL_SAFETY_CAR: "VSC",
  RED: "RF",
  YELLOW: "Y",
  DOUBLE_YELLOW: "DY",
};

const SPEEDS = [1, 5, 15, 30] as const;

function fmtDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export default function RaceScrubber({
  sessionStart, sessionEnd, scrubTime, onScrubChange,
  raceControl, currentLap, totalLaps, isLive,
  speed, onSpeedChange,
  isPlaying, onPlayingChange,
}: Props) {
  const barRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [hoverFrac, setHoverFrac] = useState<number | null>(null);

  // Guard against missing or invalid session times
  const startMs = sessionStart ? new Date(sessionStart).getTime() : null;
  const endMs = sessionEnd ? new Date(sessionEnd).getTime() : null;
  const validTimes = startMs != null && isFinite(startMs);
  const durationMs = validTimes
    ? Math.max((endMs ?? Date.now()) - startMs!, 1)
    : 1;

  const currentFrac = validTimes && scrubTime
    ? Math.min(1, Math.max(0, (scrubTime.getTime() - startMs!) / durationMs))
    : 1;

  const fracToDate = useCallback(
    (frac: number): Date => new Date(startMs! + frac * durationMs),
    [startMs, durationMs]
  );

  const getFrac = (e: MouseEvent | React.MouseEvent): number => {
    const bar = barRef.current;
    if (!bar) return 0;
    const rect = bar.getBoundingClientRect();
    return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!validTimes) return;
    dragging.current = true;
    onPlayingChange(false);
    const frac = getFrac(e);
    onScrubChange(frac >= 0.99 ? null : fracToDate(frac));
  };

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!dragging.current || !validTimes) return;
      const frac = getFrac(e);
      onScrubChange(frac >= 0.99 ? null : fracToDate(frac));
    };
    const onUp = () => { dragging.current = false; };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [fracToDate, onScrubChange, validTimes]);

  // Playback engine: each tick fires after 1s, advances scrubTime by `speed` race-seconds.
  // Uses setTimeout (not setInterval) so scrubTime is always current in closure.
  useEffect(() => {
    if (!isPlaying || !validTimes) return;
    const id = setTimeout(() => {
      const base = scrubTime ?? (endMs ? new Date(endMs) : new Date());
      const next = new Date(base.getTime() + speed * 1000);
      const endTime = endMs ?? Date.now();
      if (next.getTime() >= endTime) {
        onPlayingChange(false);
        // Stay at session end rather than going null. Setting null switches every
        // query from scrub-mode keys (with ?before=…) to live-mode keys, causing
        // all panels to fire new fetches simultaneously — visually a full "refresh".
        // Keeping scrubTime at date_end freezes the dashboard at the final state.
        if (endMs) onScrubChange(new Date(endMs));
        // Only go null (live mode) when no end time is known (live session edge case)
        else onScrubChange(null);
      } else {
        onScrubChange(next);
      }
    }, 1000);
    return () => clearTimeout(id);
  }, [isPlaying, speed, validTimes, endMs, onScrubChange, scrubTime]);

  // Stop playing when reaching live end
  useEffect(() => {
    if (!scrubTime) onPlayingChange(false);
  }, [scrubTime]);

  // Start playback from the beginning if at "live" and user hits play
  const handlePlay = () => {
    if (!validTimes) return;
    if (!scrubTime && !isPlaying) {
      // Start from beginning of session
      onScrubChange(new Date(startMs!));
    }
    onPlayingChange(!isPlaying);
  };

  // Event markers (deduplicated per flag type within 60s windows)
  const markers = validTimes
    ? (() => {
        const seen: Record<string, number> = {};
        return (raceControl ?? [])
          .filter((m) => m?.flag && FLAG_COLORS[m.flag] && m.date)
          .filter((m) => {
            const t = new Date(m.date).getTime();
            if (!isFinite(t)) return false;
            const key = m.flag!;
            if (!seen[key] || t - seen[key] > 60_000) { seen[key] = t; return true; }
            return false;
          })
          .map((m) => ({
            frac: Math.min(1, Math.max(0, (new Date(m.date).getTime() - startMs!) / durationMs)),
            flag: m.flag!,
            label: FLAG_ABBR[m.flag!] ?? "",
            color: FLAG_COLORS[m.flag!],
          }));
      })()
    : [];

  // Time-axis ticks
  const durationSec = durationMs / 1000;
  const tickInterval = durationSec <= 3600 ? 15 * 60 : 30 * 60; // every 15 or 30 min
  const tickCount = Math.floor(durationSec / tickInterval);
  const ticks = Array.from({ length: tickCount + 2 }, (_, i) => {
    const sec = i * tickInterval;
    return { frac: Math.min(1, sec / durationSec), sec };
  });

  const currentSec = validTimes
    ? ((scrubTime?.getTime() ?? (endMs ?? Date.now())) - startMs!) / 1000
    : 0;

  if (!validTimes) return null;

  return (
    <div className={styles.root}>
      {/* Left: playback controls */}
      <div className={styles.controls}>
        <button className={styles.playBtn} onClick={handlePlay} title={isPlaying ? "Pausa" : "Play"}>
          {isPlaying ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <div className={styles.speeds}>
          {SPEEDS.map((s) => (
            <button
              key={s}
              className={`${styles.speedBtn} ${speed === s ? styles.speedActive : ""}`}
              onClick={() => onSpeedChange(s)}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Center: timeline */}
      <div className={styles.track}>
        {/* Event markers */}
        {markers.map((m, i) => (
          <div
            key={i}
            className={styles.marker}
            style={{ left: `${m.frac * 100}%`, background: m.color }}
            title={m.flag}
          >
            {m.label}
          </div>
        ))}

        <div
          ref={barRef}
          className={styles.bar}
          onMouseDown={handleMouseDown}
          onMouseMove={(e) => validTimes && setHoverFrac(getFrac(e))}
          onMouseLeave={() => setHoverFrac(null)}
        >
          <div className={styles.fill} style={{ width: `${currentFrac * 100}%` }} />
          <div className={styles.thumb} style={{ left: `${currentFrac * 100}%` }} />
          {hoverFrac !== null && (
            <div className={styles.hoverTooltip} style={{ left: `${hoverFrac * 100}%` }}>
              {fmtDuration((hoverFrac * durationMs) / 1000)}
            </div>
          )}
        </div>

        <div className={styles.ticks}>
          {ticks.map(({ frac, sec }, i) => (
            <span key={i} className={styles.tick} style={{ left: `${frac * 100}%` }}>
              {fmtDuration(sec)}
            </span>
          ))}
        </div>
      </div>

      {/* Right: time / lap info */}
      <div className={styles.info}>
        <div className={styles.timeRow}>
          <span className={styles.timeInfo}>{fmtDuration(Math.max(0, currentSec))}</span>
          {currentLap != null && (
            <span className={styles.lapBadge}>
              G<strong>{currentLap}</strong>{totalLaps ? `/${totalLaps}` : ""}
            </span>
          )}
        </div>
        {isLive && !scrubTime && <span className={styles.liveBadge}>● LIVE</span>}
        {scrubTime && (
          <button className={styles.liveBtn} onClick={() => { onPlayingChange(false); onScrubChange(null); }}>
            ↩ Live
          </button>
        )}
      </div>
    </div>
  );
}
