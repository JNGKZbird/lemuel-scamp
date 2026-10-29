import { useEffect, useMemo, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import { isTauri } from "@tauri-apps/api/core";
import { getPhase } from "../pet/solar.ts";
import type { PhaseId } from "../pet/solar.ts";
import {
  buildPhaseTimeline,
  PHASE_COLORS,
} from "../pet/phase-timeline.ts";
import { PHASE_MESSAGE_KEYS, useI18n } from "../i18n";
import {
  dateAtParts,
  datePartsFromDate,
  formatDateParts,
  parseIsoDate,
  parseVirtualDateInput,
} from "../pet/calendar.ts";
import type { GeoLocation } from "../settings/store";

const BEIJING: GeoLocation = {
  lat: 39.9042,
  lon: 116.4074,
  isDefault: true,
};

const BUBBLE_WIDTH = 104;
const LAST_MINUTE = 1439;
const RESET_DURATION = 520;

type Props = {
  virtualDate: string | null;
  onVirtualDateChange: (date: string | null) => void;
  virtualMinute: number | null;
  onVirtualMinuteChange: (minute: number | null) => void;
};

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function clock(date: Date): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function timeLabel(minute: number): string {
  const total = Math.max(0, Math.floor(minute));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

function sliderLabel(minute: number): string {
  return timeLabel(Math.min(LAST_MINUTE, Math.max(0, minute)));
}

function parseTimeInput(value: string): number | null {
  const normalized = value
    .trim()
    .replace(/[０-９]/g, (char) =>
      String.fromCharCode(char.charCodeAt(0) - 0xfee0),
    )
    .replace(/：/g, ":");
  const match = /^(\d{1,2}):(\d{1,2})$/.exec(normalized);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

export default function PhaseRail({
  virtualDate,
  onVirtualDateChange,
  virtualMinute,
  onVirtualMinuteChange,
}: Props) {
  const { t } = useI18n();
  const [now, setNow] = useState(() => new Date());
  const [location, setLocation] = useState<GeoLocation>(BEIJING);
  const [barWidth, setBarWidth] = useState(0);
  const [resetAnim, setResetAnim] = useState<number | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [dateDraft, setDateDraft] = useState<string | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef(false);
  const resetRaf = useRef(0);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    const element = barRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => {
      setBarWidth(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    setBarWidth(element.getBoundingClientRect().width);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    let alive = true;
    let stop: (() => void) | null = null;
    import("../settings/store")
      .then(({ getLocation, subscribeLocation }) => {
        getLocation()
          .then((stored) => {
            if (alive) setLocation(stored);
          })
          .catch((error) => console.error("[phase-rail] location", error));
        subscribeLocation((stored) => {
          if (alive) setLocation(stored);
        })
          .then((unlisten) => {
            if (alive) stop = unlisten;
            else unlisten();
          })
          .catch((error) => console.error("[phase-rail] subscribe", error));
      })
      .catch((error) => console.error("[phase-rail] settings", error));
    return () => {
      alive = false;
      stop?.();
    };
  }, []);

  useEffect(
    () => () => {
      if (resetRaf.current) cancelAnimationFrame(resetRaf.current);
    },
    [],
  );

  const storedParts =
    virtualDate !== null ? parseIsoDate(virtualDate) : null;
  const baseParts = storedParts ?? datePartsFromDate(now);
  const dateKey = formatDateParts(baseParts);
  const dayStart = useMemo(
    () =>
      new Date(
        baseParts.year,
        baseParts.month - 1,
        baseParts.day,
        0,
        0,
        0,
        0,
      ).getTime(),
    [dateKey],
  );

  const timeline = useMemo(
    () => buildPhaseTimeline(dayStart, location.lat, location.lon),
    [dateKey, location.lat, location.lon],
  );

  const liveMinute =
    now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const virtualDisplay = resetAnim ?? virtualMinute;
  const isPreview = storedParts !== null || virtualDisplay !== null;
  const displayMinute = virtualDisplay ?? liveMinute;

  const liveInfo = useMemo(
    () => getPhase(now, location.lat, location.lon),
    [now, location.lat, location.lon],
  );
  const displayInfo = useMemo(() => {
    if (!isPreview) return liveInfo;
    return getPhase(
      dateAtParts(baseParts, displayMinute),
      location.lat,
      location.lon,
    );
  }, [
    isPreview,
    baseParts.year,
    baseParts.month,
    baseParts.day,
    displayMinute,
    liveInfo,
    location.lat,
    location.lon,
  ]);

  const phases = useMemo(() => {
    const seen: PhaseId[] = [];
    for (const block of timeline) {
      if (!seen.includes(block.phase)) seen.push(block.phase);
    }
    return seen;
  }, [timeline]);

  const selectedMinute = Math.min(
    LAST_MINUTE,
    Math.max(0, Math.floor(displayMinute)),
  );
  const displayPct = (displayMinute / 1440) * 100;
  const livePct = (liveMinute / 1440) * 100;
  const bubbleTime = isPreview ? sliderLabel(displayMinute) : clock(now);
  const bubblePhase = t(PHASE_MESSAGE_KEYS[displayInfo.phase]);
  const phaseSummary = phases
    .map((phase) => t(PHASE_MESSAGE_KEYS[phase]))
    .join(t("list.separator"));

  const rawCenter = barWidth > 0 ? (displayMinute / 1440) * barWidth : 0;
  const half = BUBBLE_WIDTH / 2;
  const bubbleCenter =
    barWidth <= BUBBLE_WIDTH
      ? barWidth / 2
      : Math.min(Math.max(rawCenter, half), barWidth - half);
  const pointerOffset = rawCenter - bubbleCenter;
  const bubbleStyle = {
    left: bubbleCenter,
    "--pointer-x": `${pointerOffset}px`,
  } as CSSProperties;

  const cancelReset = () => {
    if (resetRaf.current) cancelAnimationFrame(resetRaf.current);
    resetRaf.current = 0;
    setResetAnim(null);
  };

  const updateFromClientX = (clientX: number) => {
    const element = barRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0) return;
    const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
    onVirtualMinuteChange(
      Math.min(LAST_MINUTE, Math.round(ratio * 1440)),
    );
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    cancelReset();
    draggingRef.current = true;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    event.currentTarget.focus({ preventScroll: true });
    updateFromClientX(event.clientX);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (draggingRef.current) updateFromClientX(event.clientX);
  };

  const endDrag = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const base = Math.round(displayMinute);
    const step = event.shiftKey ? 15 : 5;
    let next: number | null = null;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = base - step;
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = base + step;
    } else if (event.key === "PageDown") {
      next = base - 60;
    } else if (event.key === "PageUp") {
      next = base + 60;
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = LAST_MINUTE;
    } else {
      return;
    }
    if (next === null) return;
    event.preventDefault();
    cancelReset();
    onVirtualMinuteChange(Math.min(LAST_MINUTE, Math.max(0, next)));
  };

  const resetToLive = () => {
    if (resetAnim !== null) return;
    if (virtualMinute === null && virtualDate === null) return;
    const from = virtualMinute;
    const to = liveMinute;
    onVirtualDateChange(null);
    onVirtualMinuteChange(null);
    if (from === null) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    setResetAnim(from);
    const start = performance.now();
    const step = (at: number) => {
      const t = Math.min(1, (at - start) / RESET_DURATION);
      const eased = 1 - Math.pow(1 - t, 4);
      if (t >= 1) {
        resetRaf.current = 0;
        setResetAnim(null);
        return;
      }
      setResetAnim(from + (to - from) * eased);
      resetRaf.current = requestAnimationFrame(step);
    };
    resetRaf.current = requestAnimationFrame(step);
  };

  const commitDate = (value: string) => {
    const parts = parseVirtualDateInput(value, new Date(dayStart));
    if (parts === null) return;
    cancelReset();
    onVirtualDateChange(formatDateParts(parts));
    if (virtualMinute === null) {
      onVirtualMinuteChange(
        Math.min(LAST_MINUTE, Math.max(0, Math.floor(liveMinute))),
      );
    }
  };

  const resettable =
    virtualDate !== null || virtualMinute !== null || resetAnim !== null;

  return (
    <section className="console-phase-rail" aria-label={t("phase.railAria")}>
      <div className="console-phase-rail__head">
        <div>
          <h3>{t("phase.railTitle")}</h3>
          <p>
            {isPreview ? t("phase.virtual") : t("phase.today")} ·{" "}
            {location.isDefault
              ? t("phase.defaultBeijing")
              : t("phase.currentCoords")}
          </p>
        </div>
        <div className="console-phase-rail__controls">
          <span className="console-phase-rail__clock">
            <i
              className="console-phase-rail__time-caret"
              aria-hidden="true"
            />
            <input
              className="console-phase-rail__date-input"
              type="text"
              aria-label={t("phase.dateAria")}
              autoComplete="off"
              spellCheck={false}
              value={dateDraft ?? dateKey}
              onFocus={(event) => {
                cancelReset();
                setDateDraft(dateKey);
                event.currentTarget.select();
              }}
              onChange={(event) => setDateDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDateDraft(null);
                  event.currentTarget.blur();
                  return;
                }
                if (event.key !== "Enter") return;
                event.preventDefault();
                commitDate(dateDraft ?? "");
                setDateDraft(null);
                event.currentTarget.blur();
              }}
              onBlur={() => setDateDraft(null)}
            />
            <span className="console-phase-rail__clock-dot" aria-hidden="true">
              ·
            </span>
            <input
              className="console-phase-rail__time-input"
              type="text"
              aria-label={t("phase.timeAria")}
              autoComplete="off"
              spellCheck={false}
              value={draft ?? sliderLabel(displayMinute)}
              onFocus={(event) => {
                cancelReset();
                setDraft(sliderLabel(displayMinute));
                event.currentTarget.select();
              }}
              onChange={(event) => setDraft(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  event.preventDefault();
                  setDraft(null);
                  event.currentTarget.blur();
                  return;
                }
                if (event.key !== "Enter") return;
                event.preventDefault();
                const minute = parseTimeInput(draft ?? "");
                if (minute !== null) {
                  cancelReset();
                  onVirtualMinuteChange(minute);
                }
                setDraft(null);
                event.currentTarget.blur();
              }}
              onBlur={() => setDraft(null)}
            />
          </span>
          {!resettable ? (
            <p className="console-phase-rail__now">
              {t("phase.live", {
                phase: t(PHASE_MESSAGE_KEYS[liveInfo.phase]),
              })}
            </p>
          ) : (
            <div className="console-phase-rail__preview">
              <span>
                {resetAnim !== null
                  ? t("phase.resetting")
                  : t("phase.virtual")}
              </span>
              <button
                type="button"
                className="console-phase-rail__reset"
                onClick={resetToLive}
                disabled={resetAnim !== null}
              >
                {t("phase.reset")}
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="console-phase-rail__bubble-lane">
        {barWidth > 0 ? (
          <div className="console-phase-rail__bubble" style={bubbleStyle}>
            <strong>{bubbleTime}</strong>
            <span>{bubblePhase}</span>
          </div>
        ) : null}
      </div>

      <div
        ref={barRef}
        className="console-phase-rail__bar"
        role="slider"
        tabIndex={0}
        aria-label={t("phase.sliderAria")}
        aria-valuemin={0}
        aria-valuemax={LAST_MINUTE}
        aria-valuenow={selectedMinute}
        aria-valuetext={t("phase.sliderValue", {
          time: bubbleTime,
          phase: bubblePhase,
          state: isPreview ? t("phase.virtualState") : t("phase.liveState"),
        })}
        aria-orientation="horizontal"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onKeyDown={onKeyDown}
      >
        <div
          className="console-phase-rail__segments"
          role="img"
          aria-label={t("phase.blocksAria", { phases: phaseSummary })}
        >
          {timeline.map((block) => (
            <span
              key={`${block.start}-${block.phase}`}
              className="console-phase-rail__seg"
              style={{
                left: `${(block.start / 1440) * 100}%`,
                width: `${((block.end - block.start) / 1440) * 100}%`,
                background: PHASE_COLORS[block.phase],
              }}
              title={`${t(PHASE_MESSAGE_KEYS[block.phase])} ${timeLabel(
                block.start,
              )}–${timeLabel(block.end)}`}
            />
          ))}
        </div>
        {isPreview && storedParts === null ? (
          <span
            className="console-phase-rail__now-line"
            style={{ left: `${livePct}%` }}
            title={t("phase.now")}
            aria-hidden="true"
          />
        ) : null}
        <span
          className="console-phase-rail__handle"
          style={{ left: `${displayPct}%` }}
          aria-hidden="true"
        />
        <span className="console-phase-rail__frame" aria-hidden="true" />
      </div>

      <div className="console-phase-rail__labels" aria-hidden="true">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>24</span>
      </div>

      <div className="console-phase-rail__legend">
        {phases.map((phase) => (
          <span className="console-phase-rail__legend-item" key={phase}>
            <i
              style={{ background: PHASE_COLORS[phase] }}
              aria-hidden="true"
            />
            {t(PHASE_MESSAGE_KEYS[phase])}
          </span>
        ))}
      </div>
    </section>
  );
}
