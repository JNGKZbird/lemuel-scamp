import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent, PointerEvent as ReactPointerEvent } from "react";
import { getPhase, solarAltitude } from "../pet/solar.ts";
import { seasonId } from "../pet/season.ts";
import {
  PHASE_MESSAGE_KEYS,
  SEASON_MESSAGE_KEYS,
  localizeGlobeError,
  useI18n,
} from "../i18n";
import { GlobeRenderer } from "./GlobeRenderer.ts";
import {
  DEFAULT_GLOBE_PALETTE,
  GLOBE_PALETTES,
  type GlobePaletteId,
} from "./palette.ts";
import "./globe.css";

type Props = {
  lat: number;
  lon: number;
  date: Date;
  isDefault?: boolean;
  onLocationChange?: (lat: number, lon: number) => void;
  paletteId?: GlobePaletteId;
  terminatorWidthDeg?: number;
  terminatorStrength?: number;
  sunCorePx?: number;
  sunBloomPx?: number;
  sunIntensity?: number;
  sunFlare?: number;
  sunViewFalloff?: number;
  moonSizePx?: number;
  moonDarkLevel?: number;
  resetToken?: number;
};

function formatCoords(lat: number, lon: number): string {
  const latSide = lat >= 0 ? "N" : "S";
  const lonSide = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(2)}°${latSide} ${Math.abs(lon).toFixed(2)}°${lonSide}`;
}

function formatAltitude(altitude: number): string {
  const rounded = Math.round(altitude);
  return rounded >= 0 ? `+${rounded}°` : `-${Math.abs(rounded)}°`;
}

function ResetIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="4.6" />
        <path d="M12 3.5v3M12 17.5v3M3.5 12h3M17.5 12h3" />
      </g>
    </svg>
  );
}

export default function GlobeView({
  lat,
  lon,
  date,
  isDefault = true,
  onLocationChange,
  paletteId = DEFAULT_GLOBE_PALETTE,
  terminatorWidthDeg = 8,
  terminatorStrength = 0.28,
  sunCorePx = 4,
  sunBloomPx = 80,
  sunIntensity = 1,
  sunFlare = 0.9,
  sunViewFalloff = 0.2,
  moonSizePx = 8,
  moonDarkLevel = 0.2,
  resetToken = 0,
}: Props) {
  const { lang, t } = useI18n();
  const palette = GLOBE_PALETTES[paletteId];
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const dragRef = useRef({
    active: false,
    lastX: 0,
    lastY: 0,
    moved: false,
    nearMars: false,
    nearUser: false,
  });
  const reducedMotionRef = useRef(false);
  const marsLabelTimer = useRef(0);
  const [dragging, setDragging] = useState(false);
  const [hasDragged, setHasDragged] = useState(false);
  const [marsLabel, setMarsLabel] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [fallback, setFallback] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState<{
    lat: string;
    lon: string;
    error: boolean;
  } | null>(null);
  const [locationAnchor, setLocationAnchor] = useState<{
    x: number;
    y: number;
    width: number;
    height: number;
    yawDeg: number;
    pitchDeg: number;
    visible: boolean;
  } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let renderer: GlobeRenderer | null = null;
    try {
      renderer = new GlobeRenderer(canvas, {
        onFallback: (reason) => {
          console.warn("[globe] fallback", reason);
          setFallback(reason);
        },
      });
    } catch (err) {
      console.error("[globe] init", err);
      setFallback("WebGL 初始化失败");
      return;
    }
    rendererRef.current = renderer;
    if (!renderer.ready) {
      renderer.dispose();
      rendererRef.current = null;
      return;
    }
    setFallback(null);

    const applyResize = () => {
      renderer?.resize(container.clientWidth, container.clientHeight);
    };
    const observer = new ResizeObserver(applyResize);
    observer.observe(container);
    applyResize();

    return () => {
      observer.disconnect();
      renderer?.dispose();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.setScene({
      date,
      lat,
      lon,
      palette,
      terminatorWidthDeg,
      terminatorStrength,
      sunCorePx,
      sunBloomPx,
      sunIntensity,
      sunFlare,
      sunViewFalloff,
      moonSizePx,
      moonDarkLevel,
    });
  }, [
    date,
    lat,
    lon,
    palette,
    terminatorWidthDeg,
    terminatorStrength,
    sunCorePx,
    sunBloomPx,
    sunIntensity,
    sunFlare,
    sunViewFalloff,
    moonSizePx,
    moonDarkLevel,
  ]);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    reducedMotionRef.current = media.matches;
    const onChange = (event: MediaQueryListEvent) => {
      reducedMotionRef.current = event.matches;
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  const info = useMemo(() => {
    const phaseInfo = getPhase(date, lat, lon);
    const altitude = solarAltitude(date, lat, lon);
    const phaseLabel =
      phaseInfo.solar.polar === "day"
        ? t("globe.polarDay")
        : phaseInfo.solar.polar === "night"
          ? t("globe.polarNight")
          : t(PHASE_MESSAGE_KEYS[phaseInfo.phase]);
    const season = t(SEASON_MESSAGE_KEYS[seasonId(date, lat)]);
    return { phaseLabel, altitude, season };
  }, [date, lat, lon, t]);

  useEffect(() => {
    return () => {
      if (marsLabelTimer.current) window.clearTimeout(marsLabelTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!resetToken) return;
    rendererRef.current?.resetView(!reducedMotionRef.current);
    setHasDragged(false);
  }, [resetToken]);

  const hideMarsLabel = () => {
    if (marsLabelTimer.current) {
      window.clearTimeout(marsLabelTimer.current);
      marsLabelTimer.current = 0;
    }
    setMarsLabel(null);
  };

  const showMarsLabel = (x: number, y: number, autoHide: boolean) => {
    if (marsLabelTimer.current) {
      window.clearTimeout(marsLabelTimer.current);
      marsLabelTimer.current = 0;
    }
    setMarsLabel({ x, y });
    if (autoHide) {
      marsLabelTimer.current = window.setTimeout(() => {
        setMarsLabel(null);
        marsLabelTimer.current = 0;
      }, 2800);
    }
  };

  const marsNearPointer = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    const position = rendererRef.current?.marsScreenPosition();
    if (!canvas || !position?.visible) return { near: false, position: null };
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const near = Math.hypot(x - position.x, y - position.y) <= 22;
    return {
      near,
      position: near ? { x: position.x, y: position.y } : null,
    };
  };

  const userNearPointer = (clientX: number, clientY: number) => {
    if (!onLocationChange) return false;
    const canvas = canvasRef.current;
    const position = rendererRef.current?.userScreenPosition();
    if (!canvas || !position?.visible) return false;
    const rect = canvas.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    return Math.hypot(x - position.x, y - position.y) <= 24;
  };

  const syncLocationAnchor = () => {
    const position = rendererRef.current?.userScreenPosition();
    const tilt = rendererRef.current?.userSurfaceTilt();
    const container = containerRef.current;
    if (!container) return;
    if (!position?.visible || !tilt?.visible) {
      setLocationAnchor((current) =>
        current ? { ...current, visible: false } : null,
      );
      return;
    }
    setLocationAnchor({
      x: position.x,
      y: position.y,
      width: container.clientWidth,
      height: container.clientHeight,
      yawDeg: tilt.yawDeg,
      pitchDeg: tilt.pitchDeg,
      visible: true,
    });
  };

  const closeLocationEditor = () => {
    setLocationDraft(null);
    setLocationAnchor(null);
  };

  const openLocationEditor = () => {
    if (!onLocationChange) return;
    hideMarsLabel();
    syncLocationAnchor();
    setLocationDraft({
      lat: lat.toFixed(4),
      lon: lon.toFixed(4),
      error: false,
    });
  };

  const updateLocationDraft = (field: "lat" | "lon", value: string) => {
    setLocationDraft((draft) =>
      draft ? { ...draft, [field]: value, error: false } : draft,
    );
  };

  const submitLocation = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!locationDraft) return;
    const nextLat = Number(locationDraft.lat);
    const nextLon = Number(locationDraft.lon);
    if (
      locationDraft.lat.trim() === "" ||
      locationDraft.lon.trim() === "" ||
      !Number.isFinite(nextLat) ||
      !Number.isFinite(nextLon) ||
      nextLat < -90 ||
      nextLat > 90 ||
      nextLon < -180 ||
      nextLon > 180
    ) {
      setLocationDraft({ ...locationDraft, error: true });
      return;
    }
    onLocationChange?.(nextLat, nextLon);
    closeLocationEditor();
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    event.preventDefault();
    hideMarsLabel();
    const { near: nearMars } = marsNearPointer(event.clientX, event.clientY);
    const nearUser = userNearPointer(event.clientX, event.clientY);
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      active: true,
      lastX: event.clientX,
      lastY: event.clientY,
      moved: false,
      nearMars,
      nearUser,
    };
    setDragging(true);
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag.active) {
      const { near, position } = marsNearPointer(
        event.clientX,
        event.clientY,
      );
      if (near && position) {
        showMarsLabel(position.x, position.y, false);
      } else {
        hideMarsLabel();
      }
      return;
    }
    hideMarsLabel();
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 2) {
      drag.moved = true;
      setHasDragged(true);
    }
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    rendererRef.current?.dragBy(dx, dy);
    if (locationDraft) syncLocationAnchor();
  };

  const endDrag = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const drag = dragRef.current;
    if (!drag.active) return;
    drag.active = false;
    setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    if (!drag.moved) {
      if (drag.nearUser) {
        openLocationEditor();
        return;
      }
      if (drag.nearMars) {
        const position = rendererRef.current?.marsScreenPosition();
        if (position?.visible) {
          showMarsLabel(position.x, position.y, true);
        }
      }
    }
  };

  const resetView = () => {
    rendererRef.current?.resetView(!reducedMotionRef.current);
    setHasDragged(false);
    if (locationDraft) {
      window.setTimeout(() => syncLocationAnchor(), 300);
    }
  };

  const editorTransform = locationAnchor
    ? `translate(-50%, -50%) perspective(720px) rotateY(${locationAnchor.yawDeg}deg) rotateX(${locationAnchor.pitchDeg}deg) translateZ(18px)`
    : undefined;

  return (
    <div className="globe-view" ref={containerRef}>
      <canvas
        ref={canvasRef}
        className={`globe-canvas${dragging ? " is-dragging" : ""}`}
        role="img"
        aria-label={
          onLocationChange
            ? t("globe.canvasAriaEdit")
            : t("globe.canvasAria")
        }
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => {
          if (!dragRef.current.active) hideMarsLabel();
        }}
      />

      <div className="globe-hud globe-hud--place">
        <span className="globe-hud__name">
          {isDefault ? t("globe.beijing") : t("globe.custom")}
        </span>
        <span className="globe-hud__coords">{formatCoords(lat, lon)}</span>
      </div>

      <div className="globe-hud globe-hud--sun">
        <span className="globe-hud__phase">
          {t("globe.phaseSeason", {
            phase: info.phaseLabel,
            season: info.season,
          })}
        </span>
        <span className="globe-hud__alt">
          {t("globe.altitude", {
            altitude: formatAltitude(info.altitude),
          })}
        </span>
      </div>

      {marsLabel ? (
        <div
          className="globe-mars-label"
          style={{
            left: `${marsLabel.x}px`,
            top: `${marsLabel.y + (marsLabel.y < 52 ? 16 : -16)}px`,
            transform:
              marsLabel.y < 52 ? "translate(-50%, 0)" : "translate(-50%, -100%)",
          }}
          role="status"
        >
          <span className="globe-mars-label__dot" aria-hidden="true" />
          {t("globe.mars")}
        </div>
      ) : null}

      {hasDragged ? (
        <button type="button" className="globe-reset" onClick={resetView}>
          <ResetIcon />
          <span>{t("globe.back")}</span>
        </button>
      ) : (
        <span className="globe-hint" aria-hidden="true">
          {onLocationChange ? t("globe.hintEdit") : t("globe.hint")}
        </span>
      )}

      {locationDraft && locationAnchor ? (
        <div
          className={`globe-location-float${
            locationAnchor.visible ? "" : " is-hidden"
          }`}
          aria-hidden={!locationAnchor.visible}
          style={{
            left: `${locationAnchor.x}px`,
            top: `${locationAnchor.y}px`,
          }}
        >
          <span className="globe-location-shadow" aria-hidden="true" />
          <form
            className="globe-location-card"
            style={{ transform: editorTransform }}
            role="dialog"
            aria-label={t("globe.editorAria")}
            onSubmit={submitLocation}
          >
            <div className="globe-location-card__head">
              <span>{t("globe.coordsTitle")}</span>
              <button
                type="button"
                className="globe-location-card__close"
                aria-label={t("globe.close")}
                onClick={closeLocationEditor}
              >
                ×
              </button>
            </div>
            <label className="globe-location-field">
              <span>{t("globe.lat")}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="-90"
                max="90"
                value={locationDraft.lat}
                onChange={(event) =>
                  updateLocationDraft("lat", event.target.value)
                }
                autoFocus
              />
            </label>
            <label className="globe-location-field">
              <span>{t("globe.lon")}</span>
              <input
                type="number"
                inputMode="decimal"
                step="0.0001"
                min="-180"
                max="180"
                value={locationDraft.lon}
                onChange={(event) =>
                  updateLocationDraft("lon", event.target.value)
                }
              />
            </label>
            <p className="globe-location-card__hint">
              {t("globe.coordsHint")}
            </p>
            {locationDraft.error ? (
              <p className="globe-location-card__error">
                {t("globe.coordsError")}
              </p>
            ) : null}
            <div className="globe-location-card__actions">
              <button
                type="button"
                onClick={closeLocationEditor}
              >
                {t("globe.cancel")}
              </button>
              <button type="submit" className="is-primary">
                {t("globe.confirm")}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {fallback ? (
        <div className="globe-fallback" role="status">
          {localizeGlobeError(fallback, lang)}
          <br />
          {t("globe.fallbackHint")}
        </div>
      ) : null}
    </div>
  );
}
