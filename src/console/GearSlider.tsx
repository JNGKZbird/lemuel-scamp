import { useEffect, useRef, useState } from "react";
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react";
import type { Gear } from "../settings/store";

const OPTIONS: { value: Gear; label: string }[] = [
  { value: "quiet", label: "偏静" },
  { value: "standard", label: "标准" },
  { value: "active", label: "偏动" },
];

type Props = {
  label: string;
  value: Gear;
  color: string;
  inkColor: string;
  spring: { k: number; c: number };
  disabled?: boolean;
  onChange: (gear: Gear) => void;
  onEngage?: (active: boolean) => void;
};

export default function GearSlider({
  label,
  value,
  color,
  inkColor,
  spring,
  disabled = false,
  onChange,
  onEngage,
}: Props) {
  const hitRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);
  const rafRef = useRef(0);
  const posRef = useRef(0);
  const velRef = useRef(0);
  const targetRef = useRef(0);
  const indexRef = useRef(0);
  const draggingRef = useRef(false);
  const reducedRef = useRef(false);
  const [pressing, setPressing] = useState(false);

  const last = OPTIONS.length - 1;
  const found = OPTIONS.findIndex((option) => option.value === value);
  const index = Math.max(0, found);
  indexRef.current = index;

  const applyPosition = (pos: number): void => {
    const width = hitRef.current?.clientWidth ?? 0;
    const pct = Math.min(1, Math.max(0, pos / last));
    const thumb = thumbRef.current;
    const fill = fillRef.current;
    if (thumb) {
      thumb.style.transform = `translate(-50%, -50%) translate3d(${pct * width}px, 0, 0)`;
    }
    if (fill) {
      fill.style.transform = `scaleX(${pct})`;
    }
  };

  const stopAnimation = (): void => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
  };

  const animate = (): void => {
    if (reducedRef.current) {
      posRef.current = targetRef.current;
      velRef.current = 0;
      applyPosition(posRef.current);
      rafRef.current = 0;
      return;
    }
    let previous = performance.now();
    const step = (now: number): void => {
      const dt = Math.min(0.032, Math.max(0.001, (now - previous) / 1000));
      previous = now;
      const target = targetRef.current;
      const pos = posRef.current;
      const vel = velRef.current;
      const accel = (target - pos) * spring.k - vel * spring.c;
      const nextVel = vel + accel * dt;
      const nextPos = pos + nextVel * dt;
      posRef.current = nextPos;
      velRef.current = nextVel;
      applyPosition(nextPos);
      if (Math.abs(target - nextPos) < 0.0008 && Math.abs(nextVel) < 0.0008) {
        posRef.current = target;
        velRef.current = 0;
        applyPosition(target);
        rafRef.current = 0;
        return;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  };

  const startAnimation = (): void => {
    if (rafRef.current) return;
    if (reducedRef.current) {
      posRef.current = targetRef.current;
      velRef.current = 0;
      applyPosition(posRef.current);
      return;
    }
    animate();
  };

  const commit = (next: number): void => {
    if (next === indexRef.current) return;
    indexRef.current = next;
    onChange(OPTIONS[next].value);
  };

  const ratioFrom = (clientX: number): number => {
    const el = hitRef.current;
    if (!el) return indexRef.current / last;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return indexRef.current / last;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const indexFromEvent = (event: ReactPointerEvent<HTMLDivElement>): number => {
    const labelEl = (event.target as Element | null)?.closest("[data-gear-index]");
    if (labelEl) {
      const parsed = Number(labelEl.getAttribute("data-gear-index"));
      if (Number.isFinite(parsed)) return Math.max(0, Math.min(last, parsed));
    }
    return Math.min(last, Math.max(0, Math.round(ratioFrom(event.clientX) * last)));
  };

  const setFromPointer = (clientX: number, exactIndex: number | null): void => {
    if (exactIndex !== null) {
      targetRef.current = exactIndex;
      commit(exactIndex);
    } else {
      const raw = ratioFrom(clientX) * last;
      const nearest = Math.round(raw);
      const distance = Math.abs(raw - nearest);
      targetRef.current = distance < 0.22
        ? nearest + (raw - nearest) * 0.34
        : raw;
      commit(nearest);
    }
    startAnimation();
  };

  const down = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (disabled) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const exact = (event.target as Element | null)?.closest("[data-gear-index]") ? indexFromEvent(event) : null;
    draggingRef.current = true;
    setPressing(true);
    onEngage?.(true);
    setFromPointer(event.clientX, exact);
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };

  const move = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current || disabled) return;
    setFromPointer(event.clientX, null);
  };

  const up = (event: ReactPointerEvent<HTMLDivElement>): void => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setPressing(false);
    onEngage?.(false);
    targetRef.current = indexRef.current;
    startAnimation();
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const key = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (disabled) return;
    let next = indexRef.current;
    if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      next = Math.max(0, next - 1);
    } else if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      next = Math.min(last, next + 1);
    } else if (event.key === "Home") {
      next = 0;
    } else if (event.key === "End") {
      next = last;
    } else {
      return;
    }
    event.preventDefault();
    commit(next);
    targetRef.current = next;
    startAnimation();
  };

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedRef.current = reduced.matches;
    const onChangeMotion = (event: MediaQueryListEvent) => {
      reducedRef.current = event.matches;
      if (event.matches) {
        stopAnimation();
        targetRef.current = indexRef.current;
        posRef.current = indexRef.current;
        velRef.current = 0;
        applyPosition(indexRef.current);
      }
    };
    reduced.addEventListener("change", onChangeMotion);
    return () => reduced.removeEventListener("change", onChangeMotion);
  }, []);

  useEffect(() => {
    if (!draggingRef.current) {
      targetRef.current = index;
      startAnimation();
    }
  }, [index]);

  useEffect(() => {
    const element = hitRef.current;
    if (!element) return;
    const observer = new ResizeObserver(() => applyPosition(posRef.current));
    observer.observe(element);
    applyPosition(posRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => () => stopAnimation(), []);

  return (
    <div
      className={`gear-slider${disabled ? " is-disabled" : ""}${pressing ? " is-pressing" : ""}`}
      style={{ "--hair": color, "--hair-ink": inkColor } as CSSProperties}
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={last}
      aria-valuenow={index}
      aria-valuetext={OPTIONS[index].label}
      aria-disabled={disabled || undefined}
      aria-busy={disabled || undefined}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={up}
      onKeyDown={key}
    >
      <div className="gear-slider__rail-wrap" aria-hidden="true">
        <div className="gear-slider__rail" />
        <div className="gear-slider__fill" ref={fillRef} />
        <div className="gear-slider__ticks">
          {OPTIONS.map((option, i) => (
            <span
              key={option.value}
              className={`gear-slider__tick${i <= index ? " is-passed" : ""}`}
              style={{ left: `${(i / last) * 100}%` }}
            />
          ))}
        </div>
        <div className="gear-slider__hit" ref={hitRef} />
        <div className="gear-slider__thumb" ref={thumbRef}>
          <span className="gear-slider__bead" aria-hidden="true" />
        </div>
      </div>

      <div className="gear-slider__labels">
        {OPTIONS.map((option, i) => (
          <span
            key={option.value}
            className={`gear-slider__label${i === index ? " is-selected" : ""}`}
            style={{ left: `${(i / last) * 100}%` }}
            data-gear-index={i}
            aria-hidden="true"
          >
            {option.label}
          </span>
        ))}
      </div>
    </div>
  );
}
