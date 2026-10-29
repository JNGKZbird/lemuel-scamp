import { useEffect, useState } from "react";
import type { ChangeEvent } from "react";
import GlobeView from "../globe/GlobeView.tsx";
import { moonAltitude, moonPosition } from "../globe/moon.ts";
import { getSolarDay } from "../pet/solar.ts";
import {
  DEFAULT_GLOBE_PALETTE,
  type GlobePaletteId,
} from "../globe/palette.ts";
import type { ConsoleMaterial, ConsoleTheme } from "../settings/store.ts";
import "./GlobePreview.css";

const BEIJING = { lat: 39.9042, lon: 116.4074 };
const params = new URLSearchParams(location.search);

const PALETTE_OPTIONS: Array<{ id: GlobePaletteId; label: string }> = [
  { id: "ivory", label: "象牙" },
  { id: "moon", label: "月灰" },
  { id: "ice", label: "冰蓝" },
];

function readInitialPalette(): GlobePaletteId {
  const value = params.get("palette");
  return value === "ivory" || value === "moon" || value === "ice"
    ? value
    : DEFAULT_GLOBE_PALETTE;
}

function readInitialNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  if (!params.has(name)) return fallback;
  const value = Number(params.get(name));
  return Number.isFinite(value) && value >= min && value <= max
    ? value
    : fallback;
}

function readCoordinate(name: string, fallback: number, limit: number): number {
  if (!params.has(name)) return fallback;
  const value = Number(params.get(name));
  return Number.isFinite(value) && Math.abs(value) <= limit ? value : fallback;
}

function readInitialDate(): Date | null {
  const raw = params.get("at");
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isFinite(date.getTime()) ? date : null;
}

function withMinutes(base: Date, minutes: number): Date {
  return new Date(
    base.getFullYear(),
    base.getMonth(),
    base.getDate(),
    0,
    minutes,
    0,
    0,
  );
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(
    date.getMinutes(),
  ).padStart(2, "0")}`;
}

function formatDay(date: Date): string {
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

export default function GlobePreview() {
  const [theme, setTheme] = useState<ConsoleTheme>(() =>
    params.get("theme") === "black" ? "black" : "white",
  );
  const [material, setMaterial] = useState<ConsoleMaterial>(() =>
    params.get("material") === "liquid" ? "liquid" : "classic",
  );
  const [paletteId, setPaletteId] = useState<GlobePaletteId>(readInitialPalette);
  const [terminatorWidth, setTerminatorWidth] = useState(() =>
    readInitialNumber("tw", 8, 2, 20),
  );
  const [terminatorStrength, setTerminatorStrength] = useState(() =>
    readInitialNumber("warm", 0.28, 0, 0.6),
  );
  const [sunCore, setSunCore] = useState(() =>
    readInitialNumber("sunCore", 4, 0.5, 40),
  );
  const [sunBloom, setSunBloom] = useState(() =>
    readInitialNumber("sunBloom", 80, 10, 200),
  );
  const [sunIntensity, setSunIntensity] = useState(() =>
    readInitialNumber("sunIntensity", 1, 0, 2),
  );
  const [sunFlare, setSunFlare] = useState(() =>
    readInitialNumber("sunFlare", 0.9, 0, 2),
  );
  const [sunViewFalloff, setSunViewFalloff] = useState(() =>
    readInitialNumber("sunViewFalloff", 0.2, 0, 0.8),
  );
  const [moonSize, setMoonSize] = useState(() =>
    readInitialNumber("moonSize", 8, 6, 28),
  );
  const [moonDark, setMoonDark] = useState(() =>
    readInitialNumber("moonDark", 0.2, 0, 0.3),
  );
  const [manualDate, setManualDate] = useState<Date | null>(readInitialDate);
  const [now, setNow] = useState(() => new Date());
  const [resetToken, setResetToken] = useState(0);

  const lat = readCoordinate("lat", BEIJING.lat, 90);
  const lon = readCoordinate("lon", BEIJING.lon, 180);
  const isDefault = !params.has("lat") && !params.has("lon");
  const date = manualDate ?? now;
  const minutes = date.getHours() * 60 + date.getMinutes();
  const moonInfo = moonPosition(date);

  useEffect(() => {
    if (manualDate) return;
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, [manualDate]);

  const onTimeChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextMinutes = Number(event.target.value);
    if (!Number.isFinite(nextMinutes)) return;
    setManualDate(withMinutes(manualDate ?? now, nextMinutes));
  };

  const backToNow = () => {
    setManualDate(null);
    setNow(new Date());
  };

  const jumpToTwilight = () => {
    const base = manualDate ?? now;
    const day = getSolarDay(base, lat, lon);
    const target = day.sunset ?? day.civilDusk;
    if (!target) return;
    setManualDate(new Date(target.getTime() + 30 * 60_000));
    setResetToken((value) => value + 1);
  };

  const jumpToMoonPhase = (phase: "new" | "full") => {
    const base = manualDate ?? now;
    const start = base.getTime() - 20 * 86_400_000;
    let best = start;
    let bestValue = phase === "full" ? -Infinity : Infinity;
    for (let i = 0; i <= 40 * 24; i += 1) {
      const value = moonPosition(new Date(start + i * 3_600_000))
        .illuminatedFraction;
      if (phase === "full" ? value > bestValue : value < bestValue) {
        bestValue = value;
        best = start + i * 3_600_000;
      }
    }
    // 满月/新月的精确时刻月亮可能正好在地球背面；就近找一个月亮落在可见天空环的时段。
    let visible = best;
    let bestOffset = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset <= 12 * 60; offset += 15) {
      for (const sign of offset === 0 ? [1] : [-1, 1]) {
        const time = best + sign * offset * 60_000;
        const altitude = moonAltitude(new Date(time), lat, lon);
        if (altitude <= -5 && altitude >= -14) {
          if (offset < bestOffset) {
            bestOffset = offset;
            visible = time;
          }
        }
      }
      if (bestOffset !== Number.POSITIVE_INFINITY) break;
    }
    setManualDate(new Date(visible));
    setResetToken((value) => value + 1);
  };

  return (
    <div className="gp-root">
      <div className="gp-stage">
        <div className="gp-shell" data-theme={theme} data-material={material}>
          <header className="gp-topbar">
            <span className="gp-topbar__title">总控台</span>
            <span className="gp-topbar__note">虚拟地球 · 浏览器预览</span>
          </header>
          <div className="gp-content">
            <GlobeView
              lat={lat}
              lon={lon}
              date={date}
              isDefault={isDefault}
              paletteId={paletteId}
              terminatorWidthDeg={terminatorWidth}
              terminatorStrength={terminatorStrength}
              sunCorePx={sunCore}
              sunBloomPx={sunBloom}
              sunIntensity={sunIntensity}
              sunFlare={sunFlare}
              sunViewFalloff={sunViewFalloff}
              moonSizePx={moonSize}
              moonDarkLevel={moonDark}
              resetToken={resetToken}
            />
          </div>
        </div>

        <aside className="gp-controls" aria-label="预览控制">
          <div className="gp-control">
            <span className="gp-control__label">外壳底色</span>
            <div className="gp-segmented" role="group" aria-label="外壳底色">
              <button
                type="button"
                aria-pressed={theme === "white"}
                className={theme === "white" ? "is-active" : ""}
                onClick={() => setTheme("white")}
              >
                白
              </button>
              <button
                type="button"
                aria-pressed={theme === "black"}
                className={theme === "black" ? "is-active" : ""}
                onClick={() => setTheme("black")}
              >
                黑
              </button>
            </div>
          </div>

          <div className="gp-control">
            <span className="gp-control__label">外壳材质</span>
            <div className="gp-segmented" role="group" aria-label="外壳材质">
              <button
                type="button"
                aria-pressed={material === "classic"}
                className={material === "classic" ? "is-active" : ""}
                onClick={() => setMaterial("classic")}
              >
                经典
              </button>
              <button
                type="button"
                aria-pressed={material === "liquid"}
                className={material === "liquid" ? "is-active" : ""}
                onClick={() => setMaterial("liquid")}
              >
                液态
              </button>
            </div>
          </div>

          <div className="gp-control">
            <span className="gp-control__label">地球配色</span>
            <div
              className="gp-segmented gp-segmented--three"
              role="group"
              aria-label="地球配色"
            >
              {PALETTE_OPTIONS.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={paletteId === option.id}
                  className={paletteId === option.id ? "is-active" : ""}
                  onClick={() => setPaletteId(option.id)}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="gp-control">
            <div className="gp-control__row">
              <span className="gp-control__label">晨昏宽度</span>
              <span className="gp-value">{terminatorWidth.toFixed(1)}°</span>
            </div>
            <input
              type="range"
              min={2}
              max={20}
              step={0.5}
              value={terminatorWidth}
              onChange={(event) => setTerminatorWidth(Number(event.target.value))}
              aria-label="晨昏宽度"
            />
            <div className="gp-control__row">
              <span className="gp-control__label">暖度</span>
              <span className="gp-value">{terminatorStrength.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={0.6}
              step={0.01}
              value={terminatorStrength}
              onChange={(event) =>
                setTerminatorStrength(Number(event.target.value))
              }
              aria-label="晨昏暖度"
            />
          </div>

          <div className="gp-control">
            <div className="gp-control__row">
              <span className="gp-control__label">太阳 · 黄昏/黎明可见</span>
              <button type="button" className="gp-now" onClick={jumpToTwilight}>
                跳到黄昏
              </button>
            </div>
            <p className="gp-note">日面约 0.5°；光晕/眩光为曝光效果</p>
            <div className="gp-control__row">
              <span className="gp-control__label">核心</span>
              <span className="gp-value">{sunCore.toFixed(1)}px</span>
            </div>
            <input
              type="range"
              min={0.5}
              max={40}
              step={0.1}
              value={sunCore}
              onChange={(event) => setSunCore(Number(event.target.value))}
              aria-label="太阳核心大小"
            />
            <div className="gp-control__row">
              <span className="gp-control__label">光晕</span>
              <span className="gp-value">{Math.round(sunBloom)}px</span>
            </div>
            <input
              type="range"
              min={10}
              max={200}
              step={1}
              value={sunBloom}
              onChange={(event) => setSunBloom(Number(event.target.value))}
              aria-label="太阳光晕大小"
            />
            <div className="gp-control__row">
              <span className="gp-control__label">强度</span>
              <span className="gp-value">{sunIntensity.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={sunIntensity}
              onChange={(event) => setSunIntensity(Number(event.target.value))}
              aria-label="太阳强度"
            />
            <div className="gp-control__row">
              <span className="gp-control__label">眩光</span>
              <span className="gp-value">{sunFlare.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={2}
              step={0.01}
              value={sunFlare}
              onChange={(event) => setSunFlare(Number(event.target.value))}
              aria-label="太阳眩光"
            />
            <div className="gp-control__row">
              <span className="gp-control__label">侧看衰减</span>
              <span className="gp-value">{sunViewFalloff.toFixed(2)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.01}
              value={sunViewFalloff}
              onChange={(event) =>
                setSunViewFalloff(Number(event.target.value))
              }
              aria-label="太阳侧看衰减"
            />
          </div>

          <div className="gp-control">
            <div className="gp-control__row">
              <span className="gp-control__label">月亮</span>
              <span className="gp-value">
                照亮 {Math.round(moonInfo.illuminatedFraction * 100)}%
              </span>
            </div>
            <p className="gp-note">直径/暗面亮度为预览调试用</p>
            <div className="gp-control__row">
              <span className="gp-control__label">直径</span>
              <span className="gp-value">{moonSize.toFixed(1)}px</span>
            </div>
            <input
              type="range"
              min={6}
              max={28}
              step={0.5}
              value={moonSize}
              onChange={(event) => setMoonSize(Number(event.target.value))}
              aria-label="月亮直径"
            />
            <div className="gp-control__row">
              <span className="gp-control__label">暗面亮度</span>
              <span className="gp-value">{moonDark.toFixed(3)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={0.3}
              step={0.005}
              value={moonDark}
              onChange={(event) => setMoonDark(Number(event.target.value))}
              aria-label="月亮暗面亮度"
            />
            <div className="gp-control__row">
              <button
                type="button"
                className="gp-now"
                onClick={() => jumpToMoonPhase("new")}
              >
                跳到新月
              </button>
              <button
                type="button"
                className="gp-now"
                onClick={() => jumpToMoonPhase("full")}
              >
                跳到满月
              </button>
            </div>
          </div>

          <div className="gp-control">
            <div className="gp-control__row">
              <label className="gp-control__label" htmlFor="gp-time">
                时间（设备本地）
              </label>
              {manualDate ? (
                <button type="button" className="gp-now" onClick={backToNow}>
                  现在
                </button>
              ) : (
                <span className="gp-live">实时</span>
              )}
            </div>
            <div className="gp-time-value">
              {formatDay(date)} {formatTime(date)}
            </div>
            <input
              id="gp-time"
              type="range"
              min={0}
              max={1439}
              step={1}
              value={minutes}
              onChange={onTimeChange}
              aria-label="时间"
            />
          </div>
        </aside>
      </div>

      <p className="gp-footnote">
        地球页固定黑底；晨昏宽度/暖度仅预览用，正式页面用固定参数。外壳底色与材质只影响框架。坐标定位示意，不含地图底图；非测绘成果。
      </p>
    </div>
  );
}
