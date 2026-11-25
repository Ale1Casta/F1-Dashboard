import { memo, useMemo } from "react";
import type { Stint, TimingEntry } from "../../types";
import { TYRE_COLORS } from "../../types";
import styles from "./TireStrategy.module.css";

interface Props {
  stints: Stint[];
  timing: TimingEntry[];
  totalLaps?: number;
}

function TireStrategy({ stints, timing, totalLaps = 60 }: Props) {
  // Memoize all derived structures so they don't recompute on every parent render
  const { driverOrder, driverMap, byDriver, drivers } = useMemo(() => {
    const order = timing.map((t) => t.driver_number);
    const dMap: Record<number, TimingEntry> = {};
    timing.forEach((t) => (dMap[t.driver_number] = t));

    const byDrv: Record<number, Stint[]> = {};
    stints.forEach((s) => {
      if (!byDrv[s.driver_number]) byDrv[s.driver_number] = [];
      byDrv[s.driver_number].push(s);
    });

    const drvs = order.length
      ? order.filter((dn) => byDrv[dn])
      : Object.keys(byDrv).map(Number);

    return { driverOrder: order, driverMap: dMap, byDriver: byDrv, drivers: drvs };
  }, [timing, stints]);

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Strategia Gomme</span>
        <div className={styles.legend}>
          {Object.entries(TYRE_COLORS).map(([c, col]) => (
            <span key={c} className={styles.legendItem}>
              <span className={styles.legendDot} style={{ background: col }} />
              {c[0]}
            </span>
          ))}
        </div>
      </div>
      <div className="panel-body" style={{ padding: "8px 12px" }}>
        {drivers.map((dn) => {
          const driver = driverMap[dn];
          const dStints = byDriver[dn] ?? [];
          return (
            <div key={dn} className={styles.row}>
              <div className={styles.driverLabel}>
                <span
                  className={styles.teamBar}
                  style={{ background: driver ? `#${driver.team_colour}` : "#555" }}
                />
                <span className={styles.abbr}>{driver?.abbreviation ?? dn}</span>
              </div>
              <div className={styles.bar}>
                {dStints.map((s, i) => {
                  const start = ((s.lap_start - 1) / totalLaps) * 100;
                  const end = s.lap_end ? (s.lap_end / totalLaps) * 100 : 100;
                  const width = end - start;
                  const compound = (s.compound ?? "UNKNOWN").toUpperCase();
                  const color = TYRE_COLORS[compound] ?? TYRE_COLORS.UNKNOWN;
                  return (
                    <div
                      key={i}
                      className={styles.stint}
                      style={{ left: `${start}%`, width: `${width}%`, background: color }}
                      title={`${compound} — Giri ${s.lap_start}–${s.lap_end ?? "?"} (età: ${s.tyre_age_at_start}g)`}
                    >
                      <span className={styles.stintLabel} style={{ color: compound === "HARD" ? "#000" : "#000" }}>
                        {compound[0]}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
        {drivers.length === 0 && (
          <div style={{ color: "var(--text3)", textAlign: "center", padding: 24 }}>
            Dati strategia non disponibili
          </div>
        )}
      </div>
    </div>
  );
}

// memo: only re-renders when stints, timing, or totalLaps change — not on every scrubTime tick
export default memo(TireStrategy);
