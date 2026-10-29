import { useEffect, useMemo, useRef, useState } from "react";
import { load_model, SpineWebGLRenderer } from "../spine38/webgl-renderer";
import { getPhase } from "../pet/solar.ts";
import type { PhaseId, PhaseInfo } from "../pet/solar.ts";
import {
  buildPhaseTimeline,
  PHASE_COLORS,
  PHASE_LABELS,
} from "../pet/phase-timeline.ts";
import {
  allowsSleep,
  getPhaseBehavior,
  isNapPhase,
} from "../pet/phase-behavior.ts";
import type { PhaseBehavior } from "../pet/phase-behavior.ts";
import { seasonFactor } from "../pet/season.ts";
import "./PhasePreview.css";

const MODEL_DIR = "/models/angel2";
const MODEL_NAME = "build_char_1041_angel2";
const PET_W = 280;
const WALK_SPEED = 80;
const SIT_SECONDS = 3;
const DEFAULT_LAT = 39.9042;
const DEFAULT_LON = 116.4074;

type Action = "idle" | "walk" | "sit" | "sleep";

type Mode = {
  kind: Action;
  timer: number;
  x: number;
  targetX: number;
};

const ACTION_LABELS: Record<Action, string> = {
  idle: "发呆",
  walk: "走",
  sit: "坐",
  sleep: "睡",
};

const PRESETS = [
  { name: "北京", lat: 39.9042, lon: 116.4074 },
  { name: "洛杉矶", lat: 34.0522, lon: -118.2437 },
  { name: "悉尼", lat: -33.8688, lon: 151.2093 },
  { name: "特罗姆瑟", lat: 69.6492, lon: 18.9553 },
];

function rand(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function hhmm(date: Date | null): string {
  if (date === null) return "--";
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function hhmmAtOffset(ms: number, offsetHours: number): string {
  const date = new Date(ms + offsetHours * 3_600_000);
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function dateInputValue(ms: number): string {
  const date = new Date(ms);
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function minutesOfDay(ms: number): number {
  const date = new Date(ms);
  return date.getHours() * 60 + date.getMinutes();
}

function findNextPhaseChange(
  ms: number,
  lat: number,
  lon: number,
): Date | null {
  const current = getPhase(new Date(ms), lat, lon).phase;
  for (let minute = 1; minute <= 24 * 60; minute += 1) {
    const next = ms + minute * 60_000;
    if (getPhase(new Date(next), lat, lon).phase !== current) {
      return new Date(next);
    }
  }
  return null;
}

function behaviorSummary(behavior: PhaseBehavior): string {
  const idle = 1 - behavior.pWalk - behavior.pSit - behavior.pSleep;
  return `发呆 ${Math.round(idle * 100)}% · 走 ${Math.round(
    behavior.pWalk * 100,
  )}% · 坐 ${Math.round(behavior.pSit * 100)}% · 睡 ${Math.round(
    behavior.pSleep * 100,
  )}%`;
}

function initialPreviewState(): { lat: number; lon: number; ms: number } {
  const params = new URLSearchParams(window.location.search);
  const lat = clamp(Number(params.get("lat") ?? DEFAULT_LAT), -90, 90);
  const lon = clamp(Number(params.get("lon") ?? DEFAULT_LON), -180, 180);
  const date = params.get("date");
  const minuteParam = Number(params.get("minute") ?? NaN);
  let ms = Date.now();
  if (date) {
    const parts = date.split("-").map(Number);
    if (parts.length === 3 && parts.every((part) => Number.isFinite(part))) {
      const minute = Number.isFinite(minuteParam)
        ? clamp(minuteParam, 0, 1439)
        : 12 * 60;
      ms = new Date(
        parts[0],
        parts[1] - 1,
        parts[2],
        Math.floor(minute / 60),
        minute % 60,
      ).getTime();
    }
  }
  return { lat, lon, ms };
}

export default function PhasePreview() {
  const [initial] = useState(initialPreviewState);
  const [simMs, setSimMs] = useState(initial.ms);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [lat, setLat] = useState(initial.lat);
  const [lon, setLon] = useState(initial.lon);
  const [action, setAction] = useState<Action>("idle");
  const [phaseInfo, setPhaseInfo] = useState<PhaseInfo>(() =>
    getPhase(new Date(initial.ms), initial.lat, initial.lon),
  );
  const [error, setError] = useState("");

  const simRef = useRef(simMs);
  const playingRef = useRef(playing);
  const speedRef = useRef(speed);
  const latRef = useRef(lat);
  const lonRef = useRef(lon);
  const stageRef = useRef<HTMLDivElement>(null);
  const petRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<SpineWebGLRenderer | null>(null);
  const actionRef = useRef<Action>("idle");
  const phaseRef = useRef<PhaseId>(phaseInfo.phase);
  const modeRef = useRef<Mode>({
    kind: "idle",
    timer: 0,
    x: 0,
    targetX: 0,
  });

  useEffect(() => {
    playingRef.current = playing;
  }, [playing]);

  useEffect(() => {
    speedRef.current = speed;
  }, [speed]);

  const playAnimation = (name: string, loop: boolean, mix: number): void => {
    const renderer = rendererRef.current;
    if (!renderer) return;
    if (renderer.current_animation_name() === name) return;
    renderer.set_animation(name, loop, true, mix);
  };

  const resetBehavior = (): void => {
    const mode = modeRef.current;
    mode.kind = "idle";
    mode.timer = 0;
    actionRef.current = "idle";
    setAction("idle");
    playAnimation("Relax", true, 0.2);
  };

  const applyTime = (ms: number): void => {
    simRef.current = ms;
    setSimMs(ms);
    resetBehavior();
  };

  const applyLocation = (nextLat: number, nextLon: number): void => {
    latRef.current = nextLat;
    lonRef.current = nextLon;
    setLat(nextLat);
    setLon(nextLon);
    resetBehavior();
  };

  useEffect(() => {
    let disposed = false;
    let raf = 0;

    (async () => {
      const model = await load_model(MODEL_DIR, MODEL_NAME);
      if (disposed) return;
      const canvas = canvasRef.current;
      if (!canvas) return;
      const renderer = new SpineWebGLRenderer(canvas);
      await renderer.set_model(model, MODEL_DIR);
      if (disposed) return;
      rendererRef.current = renderer;

      const stageWidth = stageRef.current?.clientWidth ?? 900;
      const mode = modeRef.current;
      mode.x = Math.max(0, (stageWidth - PET_W) / 2);
      mode.targetX = mode.x;
      if (petRef.current) petRef.current.style.left = `${mode.x}px`;
      playAnimation("Relax", true, 0);

      const walkBounds = (): { min: number; max: number } => {
        const stage = stageRef.current;
        const width = stage?.clientWidth ?? 900;
        const bounds = renderer.content_bounds_css();
        if (bounds.right > bounds.left) {
          return {
            min: -bounds.left + 2,
            max: Math.max(-bounds.left + 2, width - bounds.right - 2),
          };
        }
        return { min: 0, max: Math.max(0, width - PET_W) };
      };

      const setModeIdle = (behavior: PhaseBehavior): void => {
        mode.kind = "idle";
        mode.timer = rand(behavior.idleMin, behavior.idleMax);
        actionRef.current = "idle";
        setAction("idle");
        playAnimation("Relax", true, 0.2);
      };

      const pickNext = (behavior: PhaseBehavior): void => {
        const roll = Math.random();
        if (roll < behavior.pWalk) {
          const { min, max } = walkBounds();
          let target = rand(min, max);
          if (Math.abs(target - mode.x) < 80) {
            target = mode.x < (min + max) / 2 ? max : min;
          }
          mode.kind = "walk";
          mode.targetX = target;
          actionRef.current = "walk";
          setAction("walk");
          playAnimation("Move", true, 0.2);
          return;
        }
        if (roll < behavior.pWalk + behavior.pSit) {
          mode.kind = "sit";
          mode.timer = SIT_SECONDS;
          actionRef.current = "sit";
          setAction("sit");
          playAnimation("Sit", true, 0.2);
          return;
        }
        if (roll < behavior.pWalk + behavior.pSit + behavior.pSleep) {
          mode.kind = "sleep";
          mode.timer = rand(behavior.sleepMin, behavior.sleepMax);
          actionRef.current = "sleep";
          setAction("sleep");
          playAnimation("Sleep", true, 0.2);
          return;
        }
        setModeIdle(behavior);
      };

      const advance = (dt: number): void => {
        const info = getPhase(
          new Date(simRef.current),
          latRef.current,
          lonRef.current,
        );
        const behavior = getPhaseBehavior(
          info.phase,
          info.solar.dayLengthMs / 3_600_000,
        );

        if (mode.kind === "idle") {
          mode.timer -= dt;
          if (mode.timer <= 0) pickNext(behavior);
        } else if (mode.kind === "walk") {
          const direction = mode.targetX >= mode.x ? 1 : -1;
          mode.x += direction * WALK_SPEED * dt;
          if (
            (direction === 1 && mode.x >= mode.targetX) ||
            (direction === -1 && mode.x <= mode.targetX)
          ) {
            mode.x = mode.targetX;
            setModeIdle(behavior);
          }
        } else {
          mode.timer -= dt;
          if (mode.timer <= 0) setModeIdle(behavior);
        }

        if (petRef.current) {
          petRef.current.style.left = `${mode.x}px`;
        }
      };

      let last = performance.now();
      let lastUi = 0;

      const tick = (now: number): void => {
        const dtReal = Math.min(0.1, (now - last) / 1000);
        last = now;
        const dtSim = playingRef.current
          ? dtReal * speedRef.current
          : 0;

        if (dtSim > 0) {
          simRef.current += dtSim * 1000;
          advance(dtSim);
        }

        const info = getPhase(
          new Date(simRef.current),
          latRef.current,
          lonRef.current,
        );
        if (info.phase !== phaseRef.current) {
          if (
            modeRef.current.kind === "sleep" &&
            !allowsSleep(info.phase)
          ) {
            modeRef.current.kind = "idle";
            modeRef.current.timer = 0;
            actionRef.current = "idle";
            setAction("idle");
            playAnimation("Relax", true, 0.2);
          }
          phaseRef.current = info.phase;
        }

        if (now - lastUi > 200) {
          lastUi = now;
          setPhaseInfo(info);
          setSimMs(simRef.current);
        }

        renderer.draw();
        raf = requestAnimationFrame(tick);
      };

      raf = requestAnimationFrame(tick);
    })().catch((err) => {
      console.error("[phase-preview]", err);
      setError(String(err));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
    };
  }, []);

  const local = new Date(simMs);
  const dateValue = dateInputValue(simMs);
  const minuteValue = minutesOfDay(simMs);
  const behavior = getPhaseBehavior(
    phaseInfo.phase,
    phaseInfo.solar.dayLengthMs / 3_600_000,
  );
  const dayLengthHours = phaseInfo.solar.dayLengthMs / 3_600_000;
  const offsetHours = Math.round(lon / 15);
  const offsetLabel = `UTC${offsetHours >= 0 ? "+" : ""}${offsetHours}`;
  const locationTimeLabel = hhmmAtOffset(simMs, offsetHours);
  const dayKey = local.toDateString();
  const timeline = useMemo(
    () => buildPhaseTimeline(simMs, lat, lon),
    [dayKey, lat, lon],
  );
  const nextPhase = useMemo(
    () => findNextPhaseChange(simMs, lat, lon),
    [phaseInfo.phase, dayKey, lat, lon],
  );
  const nextPhaseName = nextPhase
    ? PHASE_LABELS[getPhase(nextPhase, lat, lon).phase]
    : "—";
  const actionLabel =
    action === "sleep"
      ? isNapPhase(phaseInfo.phase)
        ? "午休"
        : phaseInfo.phase === "night"
          ? "打盹"
          : "睡觉"
      : ACTION_LABELS[action];

  const onDateChange = (value: string): void => {
    const parts = value.split("-").map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) return;
    const next = new Date(
      parts[0],
      parts[1] - 1,
      parts[2],
      Math.floor(minuteValue / 60),
      minuteValue % 60,
    );
    applyTime(next.getTime());
    setPlaying(false);
  };

  const onTimeChange = (value: number): void => {
    const next = new Date(local);
    next.setHours(Math.floor(value / 60), value % 60, 0, 0);
    applyTime(next.getTime());
    setPlaying(false);
  };

  const jumpNext = (): void => {
    if (!nextPhase) return;
    applyTime(nextPhase.getTime() + 1000);
    setPlaying(false);
  };

  return (
    <div className="pp-root">
      <header className="pp-header">
        <div>
          <h1>Lemuel Scamp · 时段行为预览</h1>
          <p>浏览器临时窗口 · 不接 Tauri · {PHASE_LABELS[phaseInfo.phase]}</p>
        </div>
        <div className="pp-clock">
          <button
            type="button"
            className="pp-primary"
            onClick={() => setPlaying((value) => !value)}
          >
            {playing ? "暂停" : "播放"}
          </button>
          <select
            value={speed}
            onChange={(event) => setSpeed(Number(event.target.value))}
            aria-label="模拟速度"
          >
            <option value={1}>1×</option>
            <option value={10}>10×</option>
            <option value={60}>60×</option>
          </select>
          <button type="button" onClick={jumpNext} disabled={!nextPhase}>
            下一时段
          </button>
        </div>
      </header>

      <section className="pp-stage-wrap">
        <div className="pp-stage" ref={stageRef}>
          <div className="pp-pet-window" ref={petRef}>
            <canvas ref={canvasRef} className="pp-canvas" />
          </div>
          <div className="pp-phase-badge">
            {PHASE_LABELS[phaseInfo.phase]}
            <span>{actionLabel}</span>
          </div>
          {error ? <div className="pp-error">{error}</div> : null}
        </div>
      </section>

      <section className="pp-panel">
        <div className="pp-controls">
          <label>
            日期
            <input
              type="date"
              value={dateValue}
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <label>
            时间 <strong>{hhmm(local)}</strong>
            <input
              type="range"
              min={0}
              max={1439}
              step={1}
              value={minuteValue}
              onChange={(event) => onTimeChange(Number(event.target.value))}
            />
          </label>
          <label>
            纬度
            <input
              type="number"
              step="0.0001"
              min={-90}
              max={90}
              value={lat}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  applyLocation(clamp(value, -90, 90), lon);
                }
              }}
            />
          </label>
          <label>
            经度
            <input
              type="number"
              step="0.0001"
              min={-180}
              max={180}
              value={lon}
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isFinite(value)) {
                  applyLocation(lat, clamp(value, -180, 180));
                }
              }}
            />
          </label>
          <div className="pp-presets">
            {PRESETS.map((preset) => (
              <button
                type="button"
                key={preset.name}
                className={
                  lat === preset.lat && lon === preset.lon ? "active" : ""
                }
                onClick={() => {
                  applyLocation(preset.lat, preset.lon);
                  setPlaying(false);
                }}
              >
                {preset.name}
              </button>
            ))}
          </div>
        </div>

        <div className="pp-info">
          <div>
            <span>当前时段</span>
            <strong>{PHASE_LABELS[phaseInfo.phase]}</strong>
          </div>
          <div>
            <span>当前动作</span>
            <strong>{actionLabel}</strong>
          </div>
          <div>
            <span>下一次变化</span>
            <strong>
              {hhmm(nextPhase)} · {nextPhaseName}
            </strong>
          </div>
          <div>
            <span>白昼</span>
            <strong>{phaseInfo.solar.polar ? "—" : `${dayLengthHours.toFixed(2)}h`}</strong>
          </div>
          <div>
            <span>季节因子</span>
            <strong>
              {phaseInfo.solar.polar
                ? "—"
                : seasonFactor(dayLengthHours).toFixed(2)}
            </strong>
          </div>
          <div>
            <span>地点时间</span>
            <strong>
              {locationTimeLabel} · {offsetLabel}
            </strong>
          </div>
          <div>
            <span>太阳正午</span>
            <strong>{hhmm(phaseInfo.solar.solarNoon)}</strong>
          </div>
          <div>
            <span>晨光 / 昏影</span>
            <strong>
              {hhmm(phaseInfo.solar.civilDawn)} / {hhmm(phaseInfo.solar.civilDusk)}
            </strong>
          </div>
          <div>
            <span>极地状态</span>
            <strong>{phaseInfo.solar.polar ?? "—"}</strong>
          </div>
        </div>

        <div className="pp-behavior">
          <div>
            <span>当前时段权重</span>
            <strong>{behaviorSummary(behavior)}</strong>
          </div>
          <div>
            <span>发呆间隔</span>
            <strong>
              {behavior.idleMin}–{behavior.idleMax}s
            </strong>
          </div>
          <div>
            <span>睡眠/午休</span>
            <strong>
              {behavior.pSleep > 0
                ? `${behavior.sleepMin}–${behavior.sleepMax}s`
                : "不允许"}
            </strong>
          </div>
        </div>
      </section>

      <section className="pp-timeline">
        <div className="pp-timeline-labels">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>24</span>
        </div>
        <div className="pp-timeline-bar">
          {timeline.map((block) => (
            <div
              key={`${block.start}-${block.phase}`}
              className="pp-timeline-seg"
              style={{
                left: `${(block.start / 1440) * 100}%`,
                width: `${((block.end - block.start) / 1440) * 100}%`,
                background: PHASE_COLORS[block.phase],
              }}
              title={`${PHASE_LABELS[block.phase]} ${Math.floor(block.start / 60)}:${pad(
                block.start % 60,
              )}–${Math.floor(block.end / 60)}:${pad(block.end % 60)}`}
            />
          ))}
          <div
            className="pp-timeline-marker"
            style={{ left: `${(minuteValue / 1440) * 100}%` }}
          />
        </div>
        <p className="pp-timeline-note">
          滑块时间按本机时区显示；地点时间按经度近似时区换算。地点只影响太阳事件，拖动时间会暂停模拟。
        </p>
      </section>
    </div>
  );
}
