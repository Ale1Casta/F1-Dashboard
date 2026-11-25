import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Play, Pause } from "lucide-react";
import type { TeamRadio as TeamRadioType, TimingEntry } from "../../types";
import { api } from "../../api/client";
import styles from "./TeamRadio.module.css";

interface Props {
  messages: TeamRadioType[];
  timing: TimingEntry[];
  sessionKey: number | null;
}

function fmtDate(s: string): string {
  const d = new Date(s);
  return d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

type TranscriptState = "idle" | "loading" | string; // string = transcribed text

function TeamRadio({ messages, timing, sessionKey }: Props) {
  const [playingUrl, setPlayingUrl] = useState<string | null>(null);
  const [transcripts, setTranscripts] = useState<Map<string, TranscriptState>>(new Map());
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const driverMap = useMemo(() => {
    const m: Record<number, TimingEntry> = {};
    timing.forEach((t) => (m[t.driver_number] = t));
    return m;
  }, [timing]);

  // Stop audio when component unmounts
  useEffect(() => {
    return () => {
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = "";
      }
    };
  }, []);

  // Reset transcripts when session changes
  useEffect(() => {
    setTranscripts(new Map());
  }, [sessionKey]);

  // Messages arrive oldest-first from App; reverse to show newest at top
  const sorted = useMemo(() => [...messages].reverse(), [messages]);

  const handlePlay = useCallback((url: string) => {
    const audio = audioRef.current;
    if (!audio) return;
    if (playingUrl === url) {
      audio.pause();
      setPlayingUrl(null);
      return;
    }
    audio.pause();
    audio.src = url;
    audio.load();
    audio.play().catch(() => setPlayingUrl(null));
    setPlayingUrl(url);
  }, [playingUrl]);

  const handleTranscript = useCallback(async (url: string) => {
    if (!sessionKey) return;
    const current = transcripts.get(url);
    // Toggle off if already showing text
    if (current && current !== "idle" && current !== "loading") {
      setTranscripts((prev) => {
        const next = new Map(prev);
        next.set(url, "idle");
        return next;
      });
      return;
    }
    if (current === "loading") return; // already in progress

    setTranscripts((prev) => new Map(prev).set(url, "loading"));
    try {
      const res = await api.transcript(sessionKey, url);
      const text = res.ok && res.text ? res.text : res.error ?? "Trascrizione non disponibile";
      setTranscripts((prev) => new Map(prev).set(url, text));
    } catch {
      setTranscripts((prev) =>
        new Map(prev).set(url, "Errore di connessione")
      );
    }
  }, [sessionKey, transcripts]);

  return (
    <div className="panel" style={{ height: "100%" }}>
      {/* Single shared <audio> element — never remounted */}
      <audio
        ref={audioRef}
        preload="none"
        onEnded={() => setPlayingUrl(null)}
        onError={() => setPlayingUrl(null)}
      />

      <div className="panel-header">
        <span className="panel-title">Team Radio</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>{messages.length} messaggi</span>
      </div>
      <div className="panel-body">
        {sorted.length === 0 && (
          <div style={{ color: "var(--text3)", textAlign: "center", padding: 24 }}>
            Nessuna comunicazione disponibile
          </div>
        )}
        {sorted.map((m) => {
          const driver = driverMap[m.driver_number];
          const isPlaying = playingUrl === m.recording_url;
          const txState = transcripts.get(m.recording_url) ?? "idle";
          const hasText = txState !== "idle" && txState !== "loading";

          return (
            <div key={m.recording_url} className={`${styles.item} ${isPlaying ? styles.itemPlaying : ""}`}>
              {/* Header row: team bar + driver info + action buttons */}
              <div className={styles.row}>
                <span
                  className={styles.teamBar}
                  style={{ background: driver ? `#${driver.team_colour}` : "#555" }}
                />
                <div className={styles.info}>
                  <span className={styles.abbr}>{driver?.abbreviation ?? `#${m.driver_number}`}</span>
                  <span className={styles.team}>{driver?.team_name ?? ""}</span>
                </div>
                <span className={styles.time}>{fmtDate(m.date)}</span>
                <div className={styles.actions}>
                  <button
                    className={`${styles.btn} ${isPlaying ? styles.playing : ""}`}
                    onClick={() => handlePlay(m.recording_url)}
                    title={isPlaying ? "Pausa" : "Riproduci"}
                  >
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />}
                  </button>
                  <button
                    className={`${styles.btn} ${styles.txBtn} ${hasText ? styles.txActive : ""} ${txState === "loading" ? styles.txLoading : ""}`}
                    onClick={() => handleTranscript(m.recording_url)}
                    title={hasText ? "Nascondi trascrizione" : "Trascrivi (Whisper)"}
                    disabled={txState === "loading"}
                  >
                    {txState === "loading" ? "⏳" : "T"}
                  </button>
                </div>
              </div>

              {/* Transcript text — shown when transcribed */}
              {txState !== "idle" && txState !== "loading" && (
                <div className={styles.transcript}>
                  "{txState}"
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// memo: only re-renders when messages / timing / sessionKey actually change
export default memo(TeamRadio);
