import { memo, useMemo, useRef, useEffect, useState } from "react";
import type { TimingEntry } from "../../types";
import { TYRE_COLORS } from "../../types";
import styles from "./TimingTower.module.css";

interface Props {
  entries: TimingEntry[];
  fastestLap?: number | null;
  positionDelta?: Map<number, number>; // positive = gained places, negative = lost
}

function fmtTime(s: number | null | undefined): string {
  if (s == null) return "—";
  const mins = Math.floor(s / 60);
  const secs = (s % 60).toFixed(3).padStart(6, "0");
  return mins > 0 ? `${mins}:${secs}` : `${secs}`;
}

function TyreIcon({ compound }: { compound: string | null }) {
  const c = (compound ?? "UNKNOWN").toUpperCase();
  const color = TYRE_COLORS[c] ?? TYRE_COLORS.UNKNOWN;
  return (
    <span className={styles.tyre} style={{ background: color }}>
      {c[0] ?? "?"}
    </span>
  );
}

// ── Overtake arrow — fades out after 4 s ─────────────────────────────────────
function OvertakeArrow({ delta }: { delta: number }) {
  const [visible, setVisible] = useState(true);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setVisible(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 4000);
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [delta]);  // re-trigger whenever delta value changes (new overtake)

  if (!visible || delta === 0) return null;
  const up = delta > 0;
  return (
    <span className={`${styles.arrow} ${up ? styles.arrowUp : styles.arrowDown}`}>
      {up ? "▲" : "▼"}
    </span>
  );
}

function TimingTower({ entries, fastestLap, positionDelta = new Map() }: Props) {
  // ── Dynamic column visibility ─────────────────────────────────────────────
  // Hide a column entirely if no driver has data for it (e.g. S1/S2/S3 early in race).
  const cols = useMemo(() => ({
    gap:     entries.some((e) => e.gap_to_leader != null),
    interval: entries.some((e) => e.interval != null),
    laptime: entries.some((e) => e.lap_duration != null),
    s1:      entries.some((e) => e.duration_sector_1 != null),
    s2:      entries.some((e) => e.duration_sector_2 != null),
    s3:      entries.some((e) => e.duration_sector_3 != null),
    tyre:    entries.some((e) => e.compound != null),
  }), [entries]);

  return (
    <div className={`panel ${styles.panel}`}>
      <div className="panel-header">
        <span className="panel-title">Timing Tower</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>
          {entries[0]?.lap_number ? `Giro ${entries[0].lap_number}` : ""}
        </span>
      </div>
      <div className={`panel-body ${styles.body}`}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th></th>{/* arrow */}
              <th>P</th>
              <th>Pilota</th>
              {cols.gap      && <th>Gap</th>}
              {cols.interval && <th className={styles.intervalCol}>Int.</th>}
              {cols.laptime  && <th>Giro</th>}
              {cols.s1       && <th className={styles.sectorCol}>S1</th>}
              {cols.s2       && <th className={styles.sectorCol}>S2</th>}
              {cols.s3       && <th className={styles.sectorCol}>S3</th>}
              {cols.tyre     && <th>Gom.</th>}
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => {
              const isFastest  = fastestLap != null && e.lap_duration === fastestLap;
              const isRetired  = !!e.is_retired;
              const isPitting  = !!e.is_pitting && !isRetired;
              const delta      = positionDelta.get(e.driver_number) ?? 0;

              const rowClass = [
                isFastest && !isRetired ? styles.fastest  : "",
                isRetired               ? styles.retired  : "",
                isPitting               ? styles.pitting  : "",
              ].filter(Boolean).join(" ");

              const tyreAge = e.tyre_age_at_start != null && e.lap_start != null
                ? e.tyre_age_at_start + (e.lap_number ?? 0) - (e.lap_start ?? 0)
                : null;

              return (
                <tr key={e.driver_number} className={rowClass}>
                  {/* Overtake arrow column */}
                  <td className={styles.arrowCell}>
                    {delta !== 0 && <OvertakeArrow delta={delta} />}
                  </td>

                  {/* Position */}
                  <td className={styles.pos}>
                    {isRetired ? (
                      <span className={styles.dnfBadge}>DNF</span>
                    ) : isPitting ? (
                      <span className={styles.pitBadge}>PIT</span>
                    ) : (
                      e.position ?? "—"
                    )}
                  </td>

                  {/* Driver */}
                  <td>
                    <div className={styles.driver}>
                      <span
                        className={styles.teamBar}
                        style={{ background: `#${e.team_colour}` }}
                      />
                      <span className={`${styles.abbr} ${isRetired ? styles.retiredText : ""}`}>
                        {e.abbreviation}
                      </span>
                      <span className={styles.team}>{e.team_name}</span>
                    </div>
                  </td>

                  {cols.gap      && <td className={styles.gap}>{e.gap_to_leader ?? "—"}</td>}
                  {cols.interval && <td className={`${styles.gap} ${styles.intervalCol}`}>{e.interval ?? "—"}</td>}
                  {cols.laptime  && (
                    <td className={`${styles.laptime} ${isFastest ? styles.purple : ""}`}>
                      {fmtTime(e.lap_duration)}
                    </td>
                  )}
                  {cols.s1 && <td className={styles.sector}>{fmtTime(e.duration_sector_1)}</td>}
                  {cols.s2 && <td className={styles.sector}>{fmtTime(e.duration_sector_2)}</td>}
                  {cols.s3 && <td className={styles.sector}>{fmtTime(e.duration_sector_3)}</td>}
                  {cols.tyre && (
                    <td>
                      <div className={styles.tyreCell}>
                        <TyreIcon compound={e.compound} />
                        {tyreAge != null && (
                          <span className={styles.tyreAge}>{tyreAge}g</span>
                        )}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default memo(TimingTower);
