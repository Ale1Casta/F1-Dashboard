import { memo, useMemo } from "react";
import type { RaceControlMessage } from "../../types";
import styles from "./RaceControl.module.css";

interface Props {
  messages: RaceControlMessage[];
}

const FLAG_COLORS: Record<string, string> = {
  GREEN: "#39b54a",
  YELLOW: "#ffd700",
  DOUBLE_YELLOW: "#ffd700",
  RED: "#e10600",
  BLUE: "#0067ff",
  BLACK_AND_WHITE: "#888",
  CHEQUERED: "#fff",
  CLEAR: "#39b54a",
  SAFETY_CAR: "#ffd700",
  VIRTUAL_SAFETY_CAR: "#ffd700",
};

const CATEGORY_ICONS: Record<string, string> = {
  Flag: "🏁",
  SafetyCar: "🚗",
  Drs: "⚡",
  Incident: "⚠️",
  Other: "📢",
};

function fmtTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString("it-IT", {
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
}

function RaceControl({ messages }: Props) {
  // Memoize the reverse — avoids O(n) work on every render.
  // Messages arrive oldest-first from App; reverse shows newest at top.
  const sorted = useMemo(() => [...messages].reverse(), [messages]);

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Race Control</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{messages.length} messaggi</span>
      </div>
      <div className="panel-body">
        {sorted.length === 0 && (
          <div style={{ color: "var(--text3)", textAlign: "center", padding: 24 }}>
            Nessun messaggio Race Control
          </div>
        )}
        {sorted.map((m, i) => {
          const flagColor = m.flag ? (FLAG_COLORS[m.flag] ?? "#888") : undefined;
          const icon = CATEGORY_ICONS[m.category] ?? "📢";
          return (
            <div key={i} className={styles.item} style={flagColor ? { borderLeftColor: flagColor } : {}}>
              <div className={styles.header}>
                <span className={styles.icon}>{icon}</span>
                {m.flag && (
                  <span className={styles.flag} style={{ color: flagColor }}>
                    {m.flag.replace(/_/g, " ")}
                  </span>
                )}
                {m.lap_number != null && (
                  <span className={styles.lap}>Giro {m.lap_number}</span>
                )}
                <span className={styles.time}>{fmtTime(m.date)}</span>
              </div>
              <p className={styles.message}>{m.message}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// memo: only re-renders when messages array reference changes (rare in scrub mode)
export default memo(RaceControl);
