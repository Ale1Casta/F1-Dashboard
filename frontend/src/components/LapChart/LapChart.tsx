import { memo, useEffect, useMemo, useRef } from "react";
import type { LapRecord, TimingEntry } from "../../types";
import styles from "./LapChart.module.css";

interface Props {
  laps: LapRecord[];
  timing: TimingEntry[];
  scrubTime?: Date | null;
}

/** Format a lap duration as "1:08.2" */
function fmtLap(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(1);
  return `${m}:${s.padStart(4, "0")}`;
}

/** Full precision for title tooltip */
function fmtLapFull(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3);
  return `${m}:${s.padStart(6, "0")}`;
}

function LapChart({ laps, timing, scrubTime }: Props) {
  const tableRef = useRef<HTMLDivElement>(null);

  // Filter laps to those at or before scrubTime
  const visibleLaps = useMemo(() => {
    if (!scrubTime) return laps;
    const cut = scrubTime.toISOString();
    return laps.filter((l) => !l.date_start || l.date_start <= cut);
  }, [laps, scrubTime]);

  // Build lap matrix: driverNumber → lapNumber → duration
  const lapMatrix = useMemo(() => {
    const m: Record<number, Record<number, number>> = {};
    for (const l of visibleLaps) {
      if (l.lap_duration == null || l.lap_duration <= 0) continue;
      if (!m[l.driver_number]) m[l.driver_number] = {};
      m[l.driver_number][l.lap_number] = l.lap_duration;
    }
    return m;
  }, [visibleLaps]);

  // Visible lap numbers: last 12
  const maxLap = useMemo(
    () => Math.max(...visibleLaps.map((l) => l.lap_number || 0), 0),
    [visibleLaps]
  );
  const lapCols = useMemo(() => {
    if (maxLap === 0) return [];
    const start = Math.max(1, maxLap - 11);
    return Array.from({ length: maxLap - start + 1 }, (_, i) => start + i);
  }, [maxLap]);

  // Session fastest lap (overall best across all drivers/laps)
  const sessionFastest = useMemo(() => {
    let best: number | null = null;
    for (const l of visibleLaps) {
      if (l.lap_duration != null && l.lap_duration > 0) {
        if (best == null || l.lap_duration < best) best = l.lap_duration;
      }
    }
    return best;
  }, [visibleLaps]);

  // Per-driver personal best
  const driverBests = useMemo(() => {
    const m: Record<number, number> = {};
    for (const l of visibleLaps) {
      if (l.lap_duration == null || l.lap_duration <= 0) continue;
      if (m[l.driver_number] == null || l.lap_duration < m[l.driver_number]) {
        m[l.driver_number] = l.lap_duration;
      }
    }
    return m;
  }, [visibleLaps]);

  // Drivers sorted by current position
  const drivers = useMemo(
    () => [...timing].sort((a, b) => (a.position ?? 99) - (b.position ?? 99)),
    [timing]
  );

  // Auto-scroll to show most recent laps
  useEffect(() => {
    if (tableRef.current) {
      tableRef.current.scrollLeft = tableRef.current.scrollWidth;
    }
  }, [maxLap]);

  if (!timing.length) {
    return (
      <div className="panel" style={{ height: "100%" }}>
        <div className="panel-header"><span className="panel-title">Storico Giri</span></div>
        <div style={{ color: "var(--text3)", padding: 16, textAlign: "center" }}>
          Seleziona una sessione
        </div>
      </div>
    );
  }

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Storico Giri</span>
        <div className={styles.legend}>
          <span className={styles.legendPurple}>Giro veloce</span>
          <span className={styles.legendGreen}>Best personale</span>
        </div>
      </div>
      <div className={styles.tableWrap} ref={tableRef}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th className={styles.driverHead}>Pilota</th>
              {lapCols.map((n) => (
                <th key={n} className={styles.lapHead}>G{n}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {drivers.map((d) => {
              const dLaps = lapMatrix[d.driver_number] ?? {};
              const personal = driverBests[d.driver_number];
              return (
                <tr key={d.driver_number}>
                  <td className={styles.driverCell}>
                    <span
                      className={styles.teamBar}
                      style={{ background: `#${d.team_colour}` }}
                    />
                    <span className={styles.abbr}>{d.abbreviation}</span>
                  </td>
                  {lapCols.map((lapNum) => {
                    const dur = dLaps[lapNum];
                    if (dur == null) {
                      return (
                        <td key={lapNum} className={styles.cell}>
                          <span className={styles.empty}>—</span>
                        </td>
                      );
                    }
                    const isSessionBest =
                      sessionFastest != null && Math.abs(dur - sessionFastest) < 0.005;
                    const isPersonalBest =
                      personal != null && !isSessionBest && Math.abs(dur - personal) < 0.005;

                    return (
                      <td
                        key={lapNum}
                        className={`${styles.cell} ${
                          isSessionBest
                            ? styles.purple
                            : isPersonalBest
                            ? styles.green
                            : ""
                        }`}
                        title={fmtLapFull(dur)}
                      >
                        {fmtLap(dur)}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(LapChart);
