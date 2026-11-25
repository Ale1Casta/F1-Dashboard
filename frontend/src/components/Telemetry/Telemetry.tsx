import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  LineChart, Line, XAxis, YAxis, Tooltip,
  ResponsiveContainer, CartesianGrid, ReferenceLine,
} from "recharts";
import { api } from "../../api/client";
import type { TimingEntry } from "../../types";
import styles from "./Telemetry.module.css";

interface Props {
  sessionKey: number | null;
  timing: TimingEntry[];
  /** Set when FastF1 historical data is available (no OpenF1 auth needed) */
  year?: number;
  round?: number;
  sessionType?: string;  // FastF1 short code: "R", "Q", "FP1", …
}

// Driver A is the primary; driver B is the optional comparison.
// Using two explicit slots avoids variable-count hooks issues.
type Slot = { abbr: string; dn: number; color: string } | null;

const COLORS = ["#e10600", "#00d2ff"] as const;

function fmtLapTime(s: number | null | undefined): string {
  if (s == null) return "";
  const m = Math.floor(s / 60);
  const sec = (s % 60).toFixed(3).padStart(6, "0");
  return m > 0 ? `${m}:${sec}` : sec;
}

// ── Single-driver telemetry hook ───────────────────────────────────────────
interface TelPoint {
  dist: number;
  speed: number;
  throttle: number;
  brake: number;
  gear: number;
  drs: number;
}

function useTelemetry(
  slot: Slot,
  lapNumber: number | null,
  year: number | undefined,
  round: number | undefined,
  sessionType: string | undefined,
  sessionKey: number | null,
) {
  const historical = !!year && !!round && !!sessionType && !!slot;
  const live       = !historical && !!sessionKey && !!slot;

  const hQuery = useQuery({
    queryKey: ["tel-h", year, round, slot?.abbr, sessionType, lapNumber],
    queryFn: () => api.telemetry(year!, round!, slot!.abbr, sessionType, lapNumber ?? undefined),
    enabled: historical,
    staleTime: Infinity,
  });

  const lQuery = useQuery({
    queryKey: ["car-d", sessionKey, slot?.dn],
    queryFn: () => api.carData(sessionKey!, slot!.dn),
    enabled: live,
    staleTime: 30_000,
  });

  const raw = historical ? hQuery.data : lQuery.data;
  const loading = historical ? hQuery.isLoading : lQuery.isLoading;

  const lapTime: number | null = historical && hQuery.data
    ? (() => {
        const t = (hQuery.data as any).lap_time as string | undefined;
        if (!t) return null;
        const parts = t.match(/(\d+):(\d+\.\d+)/);
        if (parts) return parseFloat(parts[1]) * 60 + parseFloat(parts[2]);
        return parseFloat(t) || null;
      })()
    : null;

  const points: TelPoint[] = useMemo(() => {
    if (!raw) return [];
    const arr: any[] = historical ? ((raw as any).data ?? []) : (raw as any[]);
    return arr.map((p) => ({
      dist:     p.Distance ?? p.distance ?? 0,
      speed:    p.Speed    ?? p.speed    ?? 0,
      throttle: p.Throttle ?? p.throttle ?? 0,
      // Brake: FastF1 returns float 0–1; OpenF1 returns 0 or 1 boolean-ish
      brake:    typeof p.Brake === "boolean"
                  ? (p.Brake ? 100 : 0)
                  : Math.round((p.Brake ?? p.brake ?? 0) * 100),
      gear: p.nGear ?? p.Gear ?? p.gear ?? 0,
      drs:  p.DRS   ?? p.drs  ?? 0,
    }));
  }, [raw, historical]);

  return { points, loading, lapTime };
}

// ── Chart sub-components ───────────────────────────────────────────────────
const SYNC = "tel-sync";
const GRID_COLOR = "#1a1a1a";
const TICK_STYLE = { fontSize: 9, fill: "#444" };

function XDistAxis({ hide = false }: { hide?: boolean }) {
  return (
    <XAxis
      dataKey="dist"
      tick={hide ? false : TICK_STYLE}
      tickFormatter={(v) => `${Math.round(v / 1000)}k`}
      interval="preserveStartEnd"
      axisLine={false}
      tickLine={false}
      height={hide ? 0 : 16}
    />
  );
}

interface ChartProps {
  data: any[];
  lines: { key: string; color: string; name: string }[];
  domain?: [number, number];
  label: string;
  hideX?: boolean;
  stepped?: boolean;
  drsData?: number[];
}

function MiniChart({ data, lines, domain, label, hideX, stepped, drsData }: ChartProps) {
  // Find DRS zones: segments where drs > 0
  const drsZones = useMemo(() => {
    if (!drsData || !data.length) return [];
    const zones: { x1: number; x2: number }[] = [];
    let start: number | null = null;
    data.forEach((pt, i) => {
      const active = (drsData[i] ?? 0) > 10;
      if (active && start === null) start = pt.dist;
      if (!active && start !== null) { zones.push({ x1: start, x2: pt.dist }); start = null; }
    });
    if (start !== null) zones.push({ x1: start, x2: data[data.length - 1]?.dist ?? 0 });
    return zones;
  }, [data, drsData]);

  return (
    <div className={styles.chartRow}>
      <span className={styles.chartLabel}>{label}</span>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} syncId={SYNC} margin={{ left: 0, right: 6, top: 2, bottom: 0 }}>
          <CartesianGrid strokeDasharray="2 2" stroke={GRID_COLOR} vertical={false} />
          <XDistAxis hide={hideX} />
          <YAxis domain={domain} tick={TICK_STYLE} width={28} axisLine={false} tickLine={false} />
          {/* DRS zones as background shading */}
          {drsZones.map((z, i) => (
            <ReferenceLine key={i} x={z.x1} stroke="transparent" />
          ))}
          <Tooltip
            contentStyle={{ background: "#161616", border: "1px solid #2a2a2a", borderRadius: 6, fontSize: 10, padding: "4px 8px" }}
            labelFormatter={(v) => `${Math.round(v as number)}m`}
            formatter={(v: any) => [typeof v === "number" ? v.toFixed(1) : v, ""]}
            cursor={{ stroke: "#333", strokeWidth: 1 }}
          />
          {lines.map(({ key, color, name }) => (
            <Line
              key={key}
              type={stepped ? "stepAfter" : "monotone"}
              dataKey={key}
              name={name}
              stroke={color}
              dot={false}
              strokeWidth={1.5}
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────
export default function Telemetry({ sessionKey, timing, year, round, sessionType }: Props) {
  const [slotA, setSlotA] = useState<Slot>(null);
  const [slotB, setSlotB] = useState<Slot>(null);
  const [lapA,  setLapA]  = useState<number | null>(null);  // null = fastest
  const [lapB,  setLapB]  = useState<number | null>(null);

  const historical = !!year && !!round && !!sessionType;

  const maxLap = useMemo(
    () => timing.reduce((max, t) => Math.max(max, t.lap_number ?? 0), 0),
    [timing]
  );

  const telA = useTelemetry(slotA, lapA, year, round, sessionType, sessionKey);
  const telB = useTelemetry(slotB, lapB, year, round, sessionType, sessionKey);

  // Merge A and B data on the same distance axis (align by nearest distance point)
  const merged = useMemo(() => {
    const base = telA.points.length ? telA.points : telB.points;
    if (!base.length) return [];
    return base.map((pt, i) => ({
      dist:       pt.dist,
      speedA:     pt.speed,
      throttleA:  pt.throttle,
      brakeA:     pt.brake,
      gearA:      pt.gear,
      drsA:       pt.drs,
      speedB:     telB.points[i]?.speed,
      throttleB:  telB.points[i]?.throttle,
      brakeB:     telB.points[i]?.brake,
      gearB:      telB.points[i]?.gear,
    }));
  }, [telA.points, telB.points]);

  const drsData = useMemo(() => merged.map((p) => p.drsA ?? 0), [merged]);

  // Driver pill click: toggle slot A first, then B
  const handleDriver = (t: TimingEntry) => {
    const dn = t.driver_number;
    const abbr = t.abbreviation;
    const color0 = COLORS[0];
    const color1 = COLORS[1];
    if (slotA?.dn === dn) { setSlotA(null); setLapA(null); return; }
    if (slotB?.dn === dn) { setSlotB(null); setLapB(null); return; }
    if (!slotA)  { setSlotA({ dn, abbr, color: color0 }); return; }
    if (!slotB)  { setSlotB({ dn, abbr, color: color1 }); return; }
    // Replace A (keep B)
    setSlotA({ dn, abbr, color: color0 });
    setLapA(null);
  };

  const loading = telA.loading || telB.loading;
  const hasData = merged.length > 0;

  const speedLines  = [
    ...(slotA ? [{ key: "speedA",    color: slotA.color, name: slotA.abbr }] : []),
    ...(slotB ? [{ key: "speedB",    color: slotB.color, name: slotB.abbr }] : []),
  ];
  const thrtLines = [
    ...(slotA ? [{ key: "throttleA", color: slotA.color, name: `${slotA.abbr} Thr` }] : []),
    ...(slotA ? [{ key: "brakeA",    color: "#ff6b00",   name: `${slotA.abbr} Brk` }] : []),
    ...(slotB ? [{ key: "throttleB", color: slotB.color, name: `${slotB.abbr} Thr` }] : []),
    ...(slotB ? [{ key: "brakeB",    color: "#884400",   name: `${slotB.abbr} Brk` }] : []),
  ];
  const gearLines = [
    ...(slotA ? [{ key: "gearA", color: slotA.color, name: slotA.abbr }] : []),
    ...(slotB ? [{ key: "gearB", color: slotB.color, name: slotB.abbr }] : []),
  ];

  return (
    <div className={`panel ${styles.root}`}>
      {/* ── Header ── */}
      <div className="panel-header">
        <span className="panel-title">Telemetria</span>
        {(telA.lapTime != null || telB.lapTime != null) && (
          <span className={styles.lapTimes}>
            {slotA && telA.lapTime != null && (
              <span style={{ color: slotA.color }}>{slotA.abbr} {fmtLapTime(telA.lapTime)}</span>
            )}
            {slotA && slotB && telA.lapTime != null && telB.lapTime != null && (
              <span className={styles.delta}>
                Δ {fmtLapTime(Math.abs((telB.lapTime ?? 0) - (telA.lapTime ?? 0)))}
              </span>
            )}
            {slotB && telB.lapTime != null && (
              <span style={{ color: slotB.color }}>{slotB.abbr} {fmtLapTime(telB.lapTime)}</span>
            )}
          </span>
        )}
      </div>

      {/* ── Driver picker ── */}
      <div className={styles.driverRow}>
        {timing.slice(0, 20).map((t) => {
          const idxA = slotA?.dn === t.driver_number ? 0 : -1;
          const idxB = slotB?.dn === t.driver_number ? 1 : -1;
          const idx  = idxA !== -1 ? idxA : idxB;
          const sel  = idx !== -1;
          return (
            <button
              key={t.driver_number}
              className={`${styles.dBtn} ${sel ? styles.dBtnSel : ""}`}
              style={sel ? { borderColor: COLORS[idx as 0 | 1], color: COLORS[idx as 0 | 1] } : {}}
              onClick={() => handleDriver(t)}
              title={t.full_name}
            >
              {t.abbreviation}
            </button>
          );
        })}
      </div>

      {/* ── Lap selectors ── */}
      {historical && (slotA || slotB) && (
        <div className={styles.lapRow}>
          {slotA && (
            <div className={styles.lapPicker}>
              <span style={{ color: slotA.color, fontWeight: 700 }}>{slotA.abbr}</span>
              <select
                value={lapA ?? ""}
                onChange={(e) => setLapA(e.target.value === "" ? null : Number(e.target.value))}
                className={styles.lapSelect}
              >
                <option value="">Più veloce</option>
                {Array.from({ length: maxLap }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>Giro {n}</option>
                ))}
              </select>
            </div>
          )}
          {slotB && (
            <div className={styles.lapPicker}>
              <span style={{ color: slotB.color, fontWeight: 700 }}>{slotB.abbr}</span>
              <select
                value={lapB ?? ""}
                onChange={(e) => setLapB(e.target.value === "" ? null : Number(e.target.value))}
                className={styles.lapSelect}
              >
                <option value="">Più veloce</option>
                {Array.from({ length: maxLap }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>Giro {n}</option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}

      {/* ── Charts ── */}
      <div className={styles.charts}>
        {!slotA && !slotB ? (
          <div className={styles.empty}>
            Seleziona fino a 2 piloti per visualizzare la telemetria
            {!historical && <><br /><span style={{ fontSize: 10, color: "var(--text3)" }}>Dati live disponibili con account OpenF1</span></>}
          </div>
        ) : loading && !hasData ? (
          <div className={styles.empty}>Caricamento dati…</div>
        ) : !hasData ? (
          <div className={styles.empty}>
            {historical ? "Dati telemetria non disponibili per questa sessione" : "In attesa di dati telemetria…"}
          </div>
        ) : (
          <>
            <MiniChart
              data={merged}
              lines={speedLines}
              domain={[0, 360]}
              label="Velocità km/h"
              hideX
              drsData={drsData}
            />
            <MiniChart
              data={merged}
              lines={thrtLines}
              domain={[0, 100]}
              label="Acc / Freno %"
              hideX
            />
            <MiniChart
              data={merged}
              lines={gearLines}
              domain={[0, 9]}
              label="Marcia"
              stepped
            />
          </>
        )}
      </div>
    </div>
  );
}
