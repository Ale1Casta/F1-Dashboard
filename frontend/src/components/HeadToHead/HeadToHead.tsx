import { memo, useMemo, useState } from "react";
import type { LapRecord, TimingEntry } from "../../types";
import styles from "./HeadToHead.module.css";

interface Props {
  timing: TimingEntry[];
  laps: LapRecord[];
  scrubTime?: Date | null;
}

function fmtLap(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = (sec % 60).toFixed(3);
  return `${m}:${s.padStart(6, "0")}`;
}

function fmtSec(sec: number): string {
  return (sec >= 0 ? "+" : "") + sec.toFixed(3);
}

function fmtSector(sec: number | null | undefined): string {
  return sec != null ? sec.toFixed(3) : "—";
}

function HeadToHead({ timing, laps, scrubTime }: Props) {
  const [driverA, setDriverA] = useState<number | "">("");
  const [driverB, setDriverB] = useState<number | "">("");

  const driverMap = useMemo(() => {
    const m: Record<number, TimingEntry> = {};
    timing.forEach((t) => (m[t.driver_number] = t));
    return m;
  }, [timing]);

  // Filter laps to scrubTime
  const visibleLaps = useMemo(() => {
    if (!scrubTime) return laps;
    const cut = scrubTime.toISOString();
    return laps.filter((l) => !l.date_start || l.date_start <= cut);
  }, [laps, scrubTime]);

  // Per-driver lap index: driverNumber → lapNumber → LapRecord
  const lapIndex = useMemo(() => {
    const idx: Record<number, Record<number, LapRecord>> = {};
    for (const l of visibleLaps) {
      if (!idx[l.driver_number]) idx[l.driver_number] = {};
      idx[l.driver_number][l.lap_number] = l;
    }
    return idx;
  }, [visibleLaps]);

  const dnA = driverA !== "" ? Number(driverA) : null;
  const dnB = driverB !== "" ? Number(driverB) : null;
  const entA = dnA != null ? driverMap[dnA] : null;
  const entB = dnB != null ? driverMap[dnB] : null;

  // Shared lap numbers with valid durations for both drivers (last 10)
  const compRows = useMemo(() => {
    if (dnA == null || dnB == null) return [];
    const aLaps = lapIndex[dnA] ?? {};
    const bLaps = lapIndex[dnB] ?? {};
    const shared = Object.keys(aLaps)
      .map(Number)
      .filter(
        (n) =>
          bLaps[n] != null &&
          aLaps[n].lap_duration != null &&
          bLaps[n].lap_duration != null
      )
      .sort((a, b) => a - b)
      .slice(-10);
    return shared.map((n) => ({
      lap: n,
      durA: aLaps[n].lap_duration!,
      durB: bLaps[n].lap_duration!,
    }));
  }, [dnA, dnB, lapIndex]);

  // Cumulative advantage: positive = A faster overall
  const cumulativeAdv = useMemo(
    () => compRows.reduce((sum, r) => sum + (r.durB - r.durA), 0),
    [compRows]
  );

  // Best sectors for each driver (most recent lap with all sectors)
  const sectorsA = useMemo(() => {
    if (dnA == null) return null;
    const lapsForA = Object.values(lapIndex[dnA] ?? {}).sort(
      (a, b) => b.lap_number - a.lap_number
    );
    return lapsForA.find(
      (l) => l.duration_sector_1 != null && l.duration_sector_2 != null && l.duration_sector_3 != null
    ) ?? null;
  }, [dnA, lapIndex]);

  const sectorsB = useMemo(() => {
    if (dnB == null) return null;
    const lapsForB = Object.values(lapIndex[dnB] ?? {}).sort(
      (a, b) => b.lap_number - a.lap_number
    );
    return lapsForB.find(
      (l) => l.duration_sector_1 != null && l.duration_sector_2 != null && l.duration_sector_3 != null
    ) ?? null;
  }, [dnB, lapIndex]);

  const colorA = entA ? `#${entA.team_colour}` : "#888";
  const colorB = entB ? `#${entB.team_colour}` : "#888";

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Confronto Piloti</span>
      </div>
      <div className="panel-body" style={{ padding: "8px 10px", display: "flex", flexDirection: "column", gap: 8 }}>
        {/* Driver pickers */}
        <div className={styles.pickers}>
          <select
            className={styles.picker}
            style={{ borderColor: colorA }}
            value={driverA}
            onChange={(e) => setDriverA(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">— Pilota A —</option>
            {timing.map((t) => (
              <option key={t.driver_number} value={t.driver_number}>
                {t.abbreviation} · {t.team_name}
              </option>
            ))}
          </select>
          <span className={styles.vsLabel}>vs</span>
          <select
            className={styles.picker}
            style={{ borderColor: colorB }}
            value={driverB}
            onChange={(e) => setDriverB(e.target.value === "" ? "" : Number(e.target.value))}
          >
            <option value="">— Pilota B —</option>
            {timing.map((t) => (
              <option key={t.driver_number} value={t.driver_number}>
                {t.abbreviation} · {t.team_name}
              </option>
            ))}
          </select>
        </div>

        {dnA == null || dnB == null ? (
          <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 12, fontSize: 12 }}>
            Seleziona due piloti per il confronto
          </div>
        ) : compRows.length === 0 ? (
          <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 12, fontSize: 12 }}>
            Dati insufficienti per il confronto
          </div>
        ) : (
          <>
            {/* Lap comparison table */}
            <div className={styles.tableWrap}>
              <table className={styles.table}>
                <thead>
                  <tr>
                    <th>G</th>
                    <th style={{ color: colorA }}>{entA?.abbreviation ?? "A"}</th>
                    <th>Δ</th>
                    <th style={{ color: colorB }}>{entB?.abbreviation ?? "B"}</th>
                  </tr>
                </thead>
                <tbody>
                  {compRows.map(({ lap, durA, durB }) => {
                    const diff = durA - durB; // negative = A faster
                    const aFaster = diff < 0;
                    const bFaster = diff > 0;
                    return (
                      <tr key={lap}>
                        <td className={styles.lapNum}>{lap}</td>
                        <td className={`${styles.time} ${aFaster ? styles.faster : ""}`}
                          style={aFaster ? { color: colorA } : {}}>
                          {fmtLap(durA)}
                        </td>
                        <td className={`${styles.delta} ${diff < 0 ? styles.deltaPos : styles.deltaNeg}`}>
                          {diff === 0 ? "=" : fmtSec(diff)}
                        </td>
                        <td className={`${styles.time} ${bFaster ? styles.faster : ""}`}
                          style={bFaster ? { color: colorB } : {}}>
                          {fmtLap(durB)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {/* Cumulative advantage */}
            <div className={styles.advRow}>
              <span style={{ color: "var(--text3)", fontSize: 10 }}>Vantaggio cumulativo</span>
              <span
                className={styles.advVal}
                style={{ color: cumulativeAdv < 0 ? colorA : cumulativeAdv > 0 ? colorB : "var(--text2)" }}
              >
                {cumulativeAdv === 0
                  ? "Pari"
                  : `${cumulativeAdv < 0 ? entA?.abbreviation : entB?.abbreviation} +${Math.abs(cumulativeAdv).toFixed(3)}s`}
              </span>
              <span style={{ color: "var(--text3)", fontSize: 10 }}>({compRows.length} giri)</span>
            </div>

            {/* Sector comparison — most recent lap with all sectors */}
            {sectorsA && sectorsB && (
              <div className={styles.sectors}>
                <div className={styles.sectorHeader}>Settori — ultimo giro disponibile</div>
                {(["duration_sector_1", "duration_sector_2", "duration_sector_3"] as const).map(
                  (key, i) => {
                    const sA = sectorsA[key];
                    const sB = sectorsB[key];
                    if (sA == null || sB == null) return null;
                    const aFaster = sA < sB;
                    const bFaster = sB < sA;
                    return (
                      <div key={key} className={styles.sectorRow}>
                        <span
                          className={styles.sectorVal}
                          style={{ color: aFaster ? colorA : "var(--text2)", fontWeight: aFaster ? 700 : 400 }}
                        >
                          {fmtSector(sA)}
                        </span>
                        <span className={styles.sectorLbl}>S{i + 1}</span>
                        <span
                          className={styles.sectorVal}
                          style={{ color: bFaster ? colorB : "var(--text2)", fontWeight: bFaster ? 700 : 400, textAlign: "right" }}
                        >
                          {fmtSector(sB)}
                        </span>
                        <span
                          className={`${styles.sectorDelta} ${
                            aFaster ? styles.deltaPos : bFaster ? styles.deltaNeg : ""
                          }`}
                        >
                          {sA === sB ? "=" : fmtSec(sA - sB)}
                        </span>
                      </div>
                    );
                  }
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export default memo(HeadToHead);
