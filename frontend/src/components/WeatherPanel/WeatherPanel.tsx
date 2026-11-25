import { memo, useMemo } from "react";
import type { WeatherPoint } from "../../types";
import styles from "./WeatherPanel.module.css";

interface Props {
  data: WeatherPoint[];
  scrubTime?: Date | null;
}

function windDir(deg: number): string {
  const d = ["N", "NE", "E", "SE", "S", "SO", "O", "NO"];
  return d[Math.round(deg / 45) % 8];
}

function SparkLine({ points, color, label }: { points: number[]; color: string; label: string }) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const W = 220, H = 28;
  const xs = points.map((_, i) => (i / (points.length - 1)) * W);
  const ys = points.map((v) => H - ((v - min) / range) * (H - 6) - 3);
  const path = xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${ys[i].toFixed(1)}`).join(" ");
  const last = points[points.length - 1];
  const first = points[0];
  return (
    <div className={styles.sparkRow}>
      <span className={styles.sparkLabel}>{label}</span>
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className={styles.sparkSvg}>
        <path d={path} fill="none" stroke={color} strokeWidth={1.5} strokeLinejoin="round" />
        <circle cx={xs[xs.length - 1]} cy={ys[ys.length - 1]} r={2.5} fill={color} />
      </svg>
      <span className={styles.sparkRange} style={{ color }}>
        {first.toFixed(0)}→{last.toFixed(0)}°
      </span>
    </div>
  );
}

function WeatherPanel({ data, scrubTime }: Props) {
  // Show readings up to scrubTime (or all if no scrub)
  const filtered = useMemo(() => {
    if (!scrubTime || !data.length) return data;
    const cut = scrubTime.toISOString();
    return data.filter((p) => p.date <= cut);
  }, [data, scrubTime]);

  const latest = filtered[filtered.length - 1];
  const spark = filtered.slice(-25); // last 25 readings for sparklines

  const hasRain = latest && latest.rainfall > 0;

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Meteo Pista</span>
        {hasRain && <span className={styles.rainBadge}>🌧 PIOGGIA</span>}
      </div>
      <div className="panel-body" style={{ padding: "10px 12px", gap: 10, display: "flex", flexDirection: "column" }}>
        {!latest ? (
          <div style={{ color: "var(--text3)", textAlign: "center", paddingTop: 20 }}>
            Nessun dato meteo disponibile
          </div>
        ) : (
          <>
            {/* Main stats grid */}
            <div className={styles.statGrid}>
              <div className={styles.statCard}>
                <span className={styles.statIcon}>🌡</span>
                <span className={styles.statLbl}>Aria</span>
                <span className={styles.statVal}>{latest.air_temperature.toFixed(1)}°</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statIcon}>🛣</span>
                <span className={styles.statLbl}>Pista</span>
                <span className={styles.statVal} style={{ color: "#ff9b4a" }}>
                  {latest.track_temperature.toFixed(1)}°
                </span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statIcon}>💧</span>
                <span className={styles.statLbl}>Umidità</span>
                <span className={styles.statVal}>{latest.humidity.toFixed(0)}%</span>
              </div>
              <div className={styles.statCard}>
                <span className={styles.statIcon}>💨</span>
                <span className={styles.statLbl}>Vento</span>
                <span className={styles.statVal} style={{ fontSize: 13 }}>
                  {latest.wind_speed.toFixed(1)}<span style={{ fontSize: 9, marginLeft: 2 }}>m/s</span>
                  &nbsp;{windDir(latest.wind_direction)}
                </span>
              </div>
            </div>

            {/* Rainfall indicator */}
            {hasRain && (
              <div className={styles.rainRow}>
                <span style={{ color: "#4fc3f7" }}>☔ Pioggia: {latest.rainfall.toFixed(1)} mm/h</span>
              </div>
            )}

            {/* Sparklines */}
            {spark.length > 3 && (
              <div className={styles.sparks}>
                <SparkLine points={spark.map((p) => p.track_temperature)} color="#ff9b4a" label="Pista" />
                <SparkLine points={spark.map((p) => p.air_temperature)} color="#4fc3f7" label="Aria" />
                {spark.some((p) => p.rainfall > 0) && (
                  <SparkLine points={spark.map((p) => p.rainfall)} color="#7ec8e3" label="Pioggia" />
                )}
              </div>
            )}

            {/* Timestamp */}
            <div className={styles.timestamp}>
              Ultimo aggiornamento: {new Date(latest.date).toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default memo(WeatherPanel);
