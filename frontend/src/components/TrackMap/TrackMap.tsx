import { useEffect, useRef } from "react";
import type { Position, TimingEntry, StreamPosition } from "../../types";
import styles from "./TrackMap.module.css";

interface Props {
  positions: Position[];        // live mode: latest per driver
  timing: TimingEntry[];
  trackPoints?: Position[];
  playSpeed?: number;           // race-seconds per real-second
  isPlaying?: boolean;          // false = paused → freeze at scrubTime
  positionStream?: StreamPosition[];  // scrub mode: all GPS points with pre-computed ms timestamps
  scrubTime?: Date | null;      // current playback position
}

// ─── Coordinate helpers ───────────────────────────────────────────────────────

function normalize(
  pts: { x: number; y: number }[],
  W: number,
  H: number,
  padding = 32
): { scale: number; offX: number; offY: number; minX: number; minY: number } | null {
  if (!pts.length) return null;
  const xs = pts.map((p) => p.x);
  const ys = pts.map((p) => p.y);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const rangeX = maxX - minX || 1;
  const rangeY = maxY - minY || 1;
  const scale = Math.min((W - padding * 2) / rangeX, (H - padding * 2) / rangeY);
  const offX = (W - rangeX * scale) / 2;
  const offY = (H - rangeY * scale) / 2;
  return { scale, offX, offY, minX, minY };
}

function toCanvas(x: number, y: number, H: number, norm: NonNullable<ReturnType<typeof normalize>>) {
  return {
    cx: (x - norm.minX) * norm.scale + norm.offX,
    cy: H - ((y - norm.minY) * norm.scale + norm.offY),
  };
}

// Binary-search for the interpolated position at `timeMs` in a sorted point array.
// Returns the first available point if timeMs is before the data (driver not yet in stream).
// Returns null only when the array is empty.
function findAt(
  pts: { t: number; x: number; y: number }[],
  timeMs: number
): { x: number; y: number } | null {
  if (!pts.length) return null;
  if (timeMs < pts[0].t) return { x: pts[0].x, y: pts[0].y }; // clamp to first known position
  let lo = 0, hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid].t <= timeMs) lo = mid;
    else hi = mid - 1;
  }
  const a = pts[lo];
  const b = pts[lo + 1];
  if (!b) return { x: a.x, y: a.y };
  const frac = (timeMs - a.t) / (b.t - a.t);
  return { x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac };
}

// ─── Car drawing (shared between modes) ──────────────────────────────────────

function drawCar(
  ctx: CanvasRenderingContext2D,
  H: number,
  norm: NonNullable<ReturnType<typeof normalize>>,
  x: number,
  y: number,
  dn: number,
  drivers: Record<number, TimingEntry>
) {
  const driver = drivers[dn];
  const color = driver?.team_colour ? `#${driver.team_colour}` : "#ffffff";
  const { cx, cy } = toCanvas(x, y, H, norm);

  // Glow halo
  const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, 13);
  grad.addColorStop(0, color + "55");
  grad.addColorStop(1, "transparent");
  ctx.beginPath();
  ctx.arc(cx, cy, 13, 0, Math.PI * 2);
  ctx.fillStyle = grad;
  ctx.fill();

  // Car dot
  ctx.beginPath();
  ctx.arc(cx, cy, 8, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = "rgba(0,0,0,0.6)";
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Label: always show driver abbreviation (3-letter TLA)
  const label = driver?.abbreviation ?? String(dn);
  ctx.font = `bold ${label.length <= 2 ? "8" : "7"}px 'JetBrains Mono', monospace`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 2.5;
  ctx.strokeStyle = "rgba(0,0,0,0.8)";
  ctx.strokeText(label, cx, cy);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(label, cx, cy);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TrackMap({
  positions,
  timing,
  trackPoints = [],
  playSpeed = 15,
  isPlaying = true,
  positionStream,
  scrubTime,
}: Props) {
  const canvasRef    = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // ── Refs shared with the rAF loop ──────────────────────────────────────────

  // Live mode: fromPos/toPos smoothstep interpolation
  const fromPos   = useRef<Map<number, { x: number; y: number }>>(new Map());
  const toPos     = useRef<Map<number, { x: number; y: number }>>(new Map());
  const animStart = useRef(0);
  const animDur   = useRef(1000);

  // Scrub mode: timestamp-based lookup in real GPS data.
  // Using StreamPosition directly (instead of a stripped-down copy) avoids 6 000
  // object allocations every time the stream bucket changes.
  type StreamPt = StreamPosition;
  const driverStreamRef = useRef<Map<number, StreamPt[]>>(new Map());
  const scrubTimeRef    = useRef<number | null>(null); // epoch ms, updated from prop
  const animatedMsRef   = useRef<number>(0);           // continuously advancing animation time
  const playSpeedRef    = useRef(playSpeed);
  const isPlayingRef    = useRef(isPlaying);
  const isScrubRef      = useRef(false);

  // Shared
  const trackRef     = useRef<Position[]>(trackPoints);
  const driverMapRef = useRef<Record<number, TimingEntry>>({});

  // ── Effects: sync refs from props ─────────────────────────────────────────

  useEffect(() => {
    const m: Record<number, TimingEntry> = {};
    timing.forEach((t) => (m[t.driver_number] = t));
    driverMapRef.current = m;
  }, [timing]);

  useEffect(() => {
    trackRef.current = trackPoints;
  }, [trackPoints]);

  useEffect(() => {
    playSpeedRef.current = playSpeed;
  }, [playSpeed]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  // Determine mode: scrub when stream has data and scrubTime is set
  useEffect(() => {
    isScrubRef.current = !!positionStream && positionStream.length > 0 && scrubTime != null;
  }, [positionStream, scrubTime]);

  // Pre-index the stream into per-driver arrays when it changes.
  // positionStream items are StreamPosition objects (already pre-sorted by t from the
  // backend).  We reuse the references directly — no new { t,x,y } objects are created —
  // which avoids ~6 000 allocations and the corresponding GC pressure every 4 seconds.
  // Since the backend sorts globally by t, each driver's sub-sequence is also sorted.
  useEffect(() => {
    if (!positionStream || positionStream.length === 0) {
      driverStreamRef.current = new Map();
      return;
    }
    const m = new Map<number, StreamPt[]>();
    for (const p of positionStream) {
      let arr = m.get(p.driver_number);
      if (!arr) { arr = []; m.set(p.driver_number, arr); }
      arr.push(p);            // store the original StreamPosition directly
    }
    // No sort needed: global sort on t ⟹ per-driver subsequences are already sorted
    driverStreamRef.current = m;
  }, [positionStream]);

  // Track scrubTime so the rAF loop can read it
  useEffect(() => {
    scrubTimeRef.current = scrubTime ? scrubTime.getTime() : null;
  }, [scrubTime]);

  // Live mode: start new smoothstep interpolation when positions arrive
  useEffect(() => {
    if (positionStream && positionStream.length > 0) return; // handled by scrub path
    const POS_SNAP_MS = 30_000;
    const dur = (POS_SNAP_MS / Math.max(playSpeed, 1)) * 0.9;
    const now     = performance.now();
    const elapsed = now - animStart.current;
    const t       = Math.min(elapsed / Math.max(animDur.current, 1), 1);

    // Snapshot current interpolated state as the new origin
    const newFrom = new Map<number, { x: number; y: number }>();
    toPos.current.forEach((to, dn) => {
      const from = fromPos.current.get(dn) ?? to;
      newFrom.set(dn, { x: from.x + (to.x - from.x) * t, y: from.y + (to.y - from.y) * t });
    });
    positions.forEach((p) => {
      if (!newFrom.has(p.driver_number)) newFrom.set(p.driver_number, { x: p.x, y: p.y });
    });

    fromPos.current = newFrom;
    const newTo = new Map<number, { x: number; y: number }>();
    positions.forEach((p) => newTo.set(p.driver_number, { x: p.x, y: p.y }));
    toPos.current   = newTo;
    animStart.current = now;
    animDur.current   = dur;
  }, [positions, playSpeed, positionStream]);

  // ── Single continuous rAF render loop ─────────────────────────────────────

  useEffect(() => {
    let rafId: number;
    let prevFrameTime = 0; // tracks last frame timestamp for per-frame delta calculation
    let lastW = 0, lastH = 0;
    let normCache: ReturnType<typeof normalize> = null;
    let lastTrack = trackRef.current;

    const loop = () => {
      const now = performance.now();
      // Per-frame delta in seconds; clamped to 100 ms to survive tab-background pauses
      const frameDelta = prevFrameTime > 0
        ? Math.min((now - prevFrameTime) / 1000, 0.1)
        : 0;
      prevFrameTime = now;

      const canvas    = canvasRef.current;
      const container = containerRef.current;
      if (!canvas || !container) { rafId = requestAnimationFrame(loop); return; }

      const W = container.clientWidth;
      const H = container.clientHeight;
      if (!W || !H) { rafId = requestAnimationFrame(loop); return; }

      // Resize canvas only when container dimensions change
      if (W !== lastW || H !== lastH) {
        canvas.width  = W;
        canvas.height = H;
        normCache     = null;
        lastW = W; lastH = H;
      }

      // Invalidate norm cache when the track outline changes
      const basePts = trackRef.current;
      if (basePts !== lastTrack) { normCache = null; lastTrack = basePts; }

      const ctx = canvas.getContext("2d")!;
      // Fill with opaque background first so content from other panels
      // can never show through the transparent parts of the canvas.
      ctx.fillStyle = "#0d0d0d";
      ctx.fillRect(0, 0, W, H);

      const isScrub   = isScrubRef.current;
      const hasDrivers = isScrub ? driverStreamRef.current.size > 0 : toPos.current.size > 0;

      if (!basePts.length && !hasDrivers) {
        ctx.fillStyle     = "#555";
        ctx.font          = "13px Inter, sans-serif";
        ctx.textAlign     = "center";
        ctx.textBaseline  = "middle";
        ctx.fillText("Dati posizione non ancora disponibili", W / 2, H / 2);
        rafId = requestAnimationFrame(loop);
        return;
      }

      // Normalization — cached when using stable track outline
      let norm: ReturnType<typeof normalize>;
      if (basePts.length > 0) {
        if (!normCache) normCache = normalize(basePts, W, H);
        norm = normCache;
      } else {
        // Fallback: derive from current car positions (not cached — changes each frame)
        const pts = isScrub
          ? Array.from(driverStreamRef.current.values()).flatMap((a) => a.slice(-1))
          : Array.from(toPos.current.values());
        norm = normalize(pts, W, H);
      }
      if (!norm) { rafId = requestAnimationFrame(loop); return; }

      // Track outline
      if (basePts.length > 1) {
        ctx.lineJoin = "round";
        ctx.lineCap  = "round";
        ctx.beginPath();
        const first = toCanvas(basePts[0].x, basePts[0].y, H, norm);
        ctx.moveTo(first.cx, first.cy);
        for (let i = 1; i < basePts.length; i++) {
          const { cx, cy } = toCanvas(basePts[i].x, basePts[i].y, H, norm);
          ctx.lineTo(cx, cy);
        }
        ctx.closePath();
        ctx.strokeStyle = "#252525"; ctx.lineWidth = 16; ctx.stroke();
        ctx.strokeStyle = "#333";    ctx.lineWidth = 12; ctx.stroke();
        ctx.strokeStyle = "#3e3e3e"; ctx.lineWidth = 7;  ctx.stroke();
      }

      if (!hasDrivers) { rafId = requestAnimationFrame(loop); return; }

      const drivers = driverMapRef.current;

      if (isScrub) {
        // ── Scrub mode: per-frame delta animation ─────────────────────────
        // animatedMsRef advances by (playSpeed × frameDelta) each frame when playing,
        // so the animation is perfectly smooth at 60 fps with no tick-boundary jumps.
        // When paused it snaps to scrubTimeRef so the map freezes at the exact scrubTime.
        const baseMs = scrubTimeRef.current;
        if (baseMs == null) { rafId = requestAnimationFrame(loop); return; }

        if (isPlayingRef.current) {
          animatedMsRef.current += playSpeedRef.current * frameDelta * 1000;
          // Snap forward if we're behind scrubTime (scrubTime just ticked ahead of animation)
          if (animatedMsRef.current < baseMs) animatedMsRef.current = baseMs;
          // Safety clamp: no more than 2 tick-lengths ahead (handles tab-background resume)
          const maxAhead = playSpeedRef.current * 2000;
          if (animatedMsRef.current > baseMs + maxAhead) {
            animatedMsRef.current = baseMs + maxAhead;
          }
        } else {
          // Paused or scrubbing: freeze exactly at scrubTime
          animatedMsRef.current = baseMs;
        }

        driverStreamRef.current.forEach((pts, dn) => {
          const pos = findAt(pts, animatedMsRef.current);
          if (pos) drawCar(ctx, H, norm!, pos.x, pos.y, dn, drivers);
        });
      } else {
        // ── Live mode: smoothstep interpolation between snapshots ─────────
        const raw   = Math.min((now - animStart.current) / Math.max(animDur.current, 1), 1);
        const tProg = raw * raw * (3 - 2 * raw); // smoothstep

        toPos.current.forEach((to, dn) => {
          const from = fromPos.current.get(dn) ?? to;
          const ix   = from.x + (to.x - from.x) * tProg;
          const iy   = from.y + (to.y - from.y) * tProg;
          drawCar(ctx, H, norm!, ix, iy, dn, drivers);
        });
      }

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  }, []); // Empty deps — everything read through refs

  return (
    <div className="panel" style={{ height: "100%" }}>
      <div className="panel-header">
        <span className="panel-title">Mappa Pista</span>
        <span style={{ fontSize: 11, color: "var(--text3)" }}>
          {positions.length > 0 ? `${positions.length} piloti` : "—"}
          {trackPoints.length > 0
            ? ` · tracciato ${trackPoints.length}pt`
            : " · tracciato in caricamento…"}
        </span>
      </div>
      <div className={styles.container} ref={containerRef}>
        <canvas ref={canvasRef} className={styles.canvas} />
      </div>
    </div>
  );
}
