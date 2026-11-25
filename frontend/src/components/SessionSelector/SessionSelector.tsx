import { useQuery } from "@tanstack/react-query";
import { api } from "../../api/client";
import styles from "./SessionSelector.module.css";

interface Props {
  year: number;
  onYearChange: (y: number) => void;
  meetingKey: number | null;
  onMeetingChange: (k: number) => void;
  sessionKey: number | null;
  onSessionChange: (k: number) => void;
  isLive: boolean;
  onLiveToggle: () => void;
  connected: boolean;
  /** True when the selected session is currently in progress (auto-detected from date window) */
  liveNow?: boolean;
}

const CURRENT_YEAR = new Date().getFullYear();
const YEARS = Array.from({ length: CURRENT_YEAR - 2017 }, (_, i) => CURRENT_YEAR - i);

export default function SessionSelector(props: Props) {
  const { year, meetingKey, sessionKey, isLive, onLiveToggle, connected, liveNow } = props;

  const { data: meetings = [] } = useQuery({
    queryKey: ["meetings", year],
    queryFn: () => api.meetings(year),
  });

  const { data: sessions = [] } = useQuery({
    queryKey: ["sessions", meetingKey],
    queryFn: () => api.sessions(meetingKey!),
    enabled: !!meetingKey,
  });

  return (
    <div className={styles.bar}>
      <div className={styles.logo}>
        <span className={styles.f1}>F1</span>
        <span className={styles.dash}>Dashboard</span>
      </div>

      <div className={styles.controls}>
        <button
          className={`${styles.liveBtn} ${isLive ? styles.liveActive : ""}`}
          onClick={onLiveToggle}
        >
          <span className={`${styles.dot} ${connected ? styles.dotGreen : styles.dotRed}`} />
          {isLive ? "LIVE" : "STORICO"}
          {liveNow && !isLive && (
            <span style={{
              marginLeft: 5,
              background: "#e10600",
              color: "#fff",
              fontSize: 9,
              fontWeight: 700,
              padding: "1px 4px",
              borderRadius: 3,
              letterSpacing: "0.04em",
              animation: "pulse 1.2s ease-in-out infinite",
            }}>
              ON AIR
            </span>
          )}
        </button>

        <select value={year} onChange={(e) => props.onYearChange(Number(e.target.value))}>
          {YEARS.map((y) => <option key={y} value={y}>{y}</option>)}
        </select>

        <select
          value={meetingKey ?? ""}
          onChange={(e) => props.onMeetingChange(Number(e.target.value))}
          disabled={!meetings.length}
        >
          <option value="">— Gran Premio —</option>
          {meetings.map((m: any) => (
            <option key={m.meeting_key} value={m.meeting_key}>
              {m.location} — {m.meeting_name}
            </option>
          ))}
        </select>

        <select
          value={sessionKey ?? ""}
          onChange={(e) => props.onSessionChange(Number(e.target.value))}
          disabled={!sessions.length}
        >
          <option value="">— Sessione —</option>
          {sessions.map((s: any) => (
            <option key={s.session_key} value={s.session_key}>
              {s.session_name}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
