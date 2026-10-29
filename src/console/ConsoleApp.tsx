import { Suspense, lazy, useEffect, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { flushSync } from "react-dom";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import GearSlider from "./GearSlider";
import SegmentedControl, { VisibilityToggle } from "./ConsoleControls";
import PhaseRail from "./PhaseRail";
import { useGearSettings } from "./useGearSettings";
import { useGlassStage } from "./glass/useGlassStage";
import {
  CHARACTERS,
  THICKNESSES,
  parsePreviewConfig,
  type ThemeId,
  type ThicknessLevel,
} from "./glass/config";
import { setVirtualTime } from "../settings/store";
import type { ConsoleMaterial, PetMode } from "../settings/store";
import "./ConsoleApp.css";

const CLASSIC_THEME_OPTIONS: Array<{ value: ThemeId; label: string }> = [
  { value: "white", label: "白" },
  { value: "black", label: "黑" },
];

const LIQUID_THEME_OPTIONS: Array<{ value: ThemeId; label: string }> = [
  { value: "white", label: "白瓷" },
  { value: "black", label: "黑曜" },
];

const MATERIAL_OPTIONS: Array<{ value: ConsoleMaterial; label: string }> = [
  { value: "classic", label: "经典" },
  { value: "liquid", label: "液态玻璃" },
];

const MODE_OPTIONS: Array<{ value: PetMode; label: string }> = [
  { value: "gear", label: "行为档位" },
  { value: "time", label: "虚拟地球" },
];

const OUTLINE_OPTIONS: Array<{ value: "on" | "off"; label: string }> = [
  { value: "on", label: "开启" },
  { value: "off", label: "关闭" },
];

const GlobePage = lazy(() => import("./GlobePage"));

const DEFAULT_THICKNESS: ThicknessLevel = 2;
const GEAR_SPRING = { k: 600, c: 42 };
const GEAR_BLUE = "#3b82f6";
const GEAR_INK = { white: "#2563eb", black: "#60a5fa" } as const;

type ConsolePage = "general" | "globe";

type ViewTransitionDocument = Document & {
  startViewTransition?: (callback: () => void | Promise<void>) => {
    finished: Promise<void>;
  };
};

function NavIcon({ name }: { name: ConsolePage }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {name === "general" ? (
          <>
            <path d="M4 7h16M4 12h16M4 17h16" />
            <circle cx="9" cy="7" r="1.8" />
            <circle cx="15" cy="12" r="1.8" />
            <circle cx="8" cy="17" r="1.8" />
          </>
        ) : (
          <>
            <circle cx="12" cy="12" r="9" />
            <ellipse cx="12" cy="12" rx="4" ry="9" />
            <path d="M3.5 12h17" />
          </>
        )}
      </g>
    </svg>
  );
}

export default function ConsoleApp() {
  const [config] = useState(() => parsePreviewConfig(location.search));
  const [desktop] = useState(() => isTauri());
  const [theme, setTheme] = useState<ThemeId>(config.theme);
  const [material, setMaterial] = useState<ConsoleMaterial>(() =>
    new URLSearchParams(location.search).get("material") === "liquid"
      ? "liquid"
      : "classic",
  );
  const [maximized, setMaximized] = useState(false);
  const [page, setPage] = useState<ConsolePage>(() =>
    new URLSearchParams(location.search).get("page") === "globe"
      ? "globe"
      : "general",
  );
  const [virtualDate, setVirtualDate] = useState<string | null>(null);
  const [virtualMinute, setVirtualMinute] = useState<number | null>(null);
  const shellRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const winRef = useRef<ReturnType<typeof getCurrentWindow> | null>(null);
  const themeTouchedRef = useRef(false);
  const materialTouchedRef = useRef(false);
  const transitioningRef = useRef(false);
  const {
    gears,
    mode,
    visible,
    outline,
    iceGlide,
    ready,
    setCharGear,
    setCharVisible,
    setPetMode,
    setInteractionOutline,
    setInteractionIceGlide,
  } = useGearSettings();
  const globeOverride = mode === "time";

  useEffect(() => {
    if (!desktop) return;
    const timer = window.setTimeout(() => {
      void setVirtualTime(
        virtualDate === null && virtualMinute === null
          ? null
          : { date: virtualDate, minute: virtualMinute },
      );
    }, 80);
    return () => window.clearTimeout(timer);
  }, [desktop, virtualDate, virtualMinute]);

  const thicknessConfig = THICKNESSES[DEFAULT_THICKNESS];
  const { rendererState } = useGlassStage(shellRef, canvasRef, {
    theme,
    thickness: DEFAULT_THICKNESS,
    enabled: material === "liquid",
  });

  useEffect(() => {
    if (desktop) winRef.current = getCurrentWindow();
  }, [desktop]);

  const transitionTheme = (update: () => void) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      update();
      return;
    }
    const doc = document as unknown as ViewTransitionDocument;
    if (!doc.startViewTransition || transitioningRef.current) {
      update();
      return;
    }
    transitioningRef.current = true;
    try {
      const transition = doc.startViewTransition(() => {
        flushSync(update);
      });
      transition.finished.finally(() => {
        transitioningRef.current = false;
      });
    } catch (err) {
      console.error("[console] view transition", err);
      transitioningRef.current = false;
      update();
    }
  };

  const applyTheme = (next: ThemeId) => {
    if (next === theme) return;
    themeTouchedRef.current = true;
    transitionTheme(() => setTheme(next));
    if (desktop) {
      import("../settings/store")
        .then(({ setConsoleTheme }) => setConsoleTheme(next === "black" ? "black" : "white"))
        .catch((err) => console.error("[console] save theme", err));
    }
    if (config.preview) {
      const url = new URL(location.href);
      url.searchParams.set("theme", next);
      history.replaceState(null, "", url);
    }
  };

  const applyMaterial = (next: ConsoleMaterial) => {
    if (next === material) return;
    materialTouchedRef.current = true;
    transitionTheme(() => setMaterial(next));
    if (desktop) {
      import("../settings/store")
        .then(({ setConsoleMaterial }) => setConsoleMaterial(next))
        .catch((err) => console.error("[console] save material", err));
    }
    if (config.preview) {
      const url = new URL(location.href);
      url.searchParams.set("material", next);
      history.replaceState(null, "", url);
    }
  };

  useEffect(() => {
    if (!desktop || config.preview) return;
    import("../settings/store")
      .then(({ getConsoleTheme }) => getConsoleTheme())
      .then((stored) => {
        if (!themeTouchedRef.current) setTheme(stored);
      })
      .catch((err) => console.error("[console] load theme", err));
  }, [desktop, config.preview]);

  useEffect(() => {
    if (!desktop || config.preview) return;
    import("../settings/store")
      .then(({ getConsoleMaterial }) => getConsoleMaterial())
      .then((stored) => {
        if (!materialTouchedRef.current) setMaterial(stored);
      })
      .catch((err) => console.error("[console] load material", err));
  }, [desktop, config.preview]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))
      ) {
        return;
      }
      let nextTheme = theme;
      if (event.key === "1") nextTheme = "white";
      else if (event.key === "2") nextTheme = "black";
      else return;
      event.preventDefault();
      if (nextTheme !== theme) applyTheme(nextTheme);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [theme, config.preview, desktop]);

  const minimize = () => {
    winRef.current?.minimize().catch((err) => console.error("[console] minimize", err));
  };
  const close = () => {
    winRef.current?.close().catch((err) => console.error("[console] close", err));
  };
  const toggleMaximized = () => {
    if (!desktop) return;
    const next = !maximized;
    invoke<{ x: number; y: number; width: number; height: number } | null>(
      "console_set_maximized",
      { maximized: next },
    )
      .then(async (rect) => {
        setMaximized(next);
        if (!next || !rect) return;
        // 原生切换后再按工作区矩形兜底一次：避免 WebView2/wry 异步
        // resize 把窗口或 webview 回落到旧的 1066×729。物理像素，
        // 不经过 DPI 换算，单屏/多屏下都精确落在工作区上。
        const win = winRef.current;
        if (!win) return;
        await win.setSize(new PhysicalSize(rect.width, rect.height));
        await win.setPosition(new PhysicalPosition(rect.x, rect.y));
      })
      .catch((err) => console.error("[console] maximize", err));
  };

  const style = {
    "--preview-w": `${config.width}px`,
    "--preview-h": `${config.height}px`,
    "--edge-band": `${thicknessConfig.edgeBand}px`,
  } as CSSProperties;
  const themeOptions =
    material === "liquid" ? LIQUID_THEME_OPTIONS : CLASSIC_THEME_OPTIONS;

  return (
    <div
      className={`console-root${config.preview ? " is-preview" : ""}`}
      style={style}
      data-theme={theme}
      data-material={material}
      data-thick={DEFAULT_THICKNESS}
      data-renderer={rendererState}
      aria-label="总控台"
    >
      <div className="console-shell" ref={shellRef}>
        <canvas ref={canvasRef} className="glass-canvas" aria-hidden="true" />

        <div className="console-topbar">
          <div
            className="console-drag-region"
            data-tauri-drag-region={maximized ? undefined : true}
          >
            <h1>总控台</h1>
          </div>
          <nav className="console-nav" aria-label="总控台导航">
            <button
              type="button"
              className={`console-nav__item${page === "general" ? " is-active" : ""}`}
              aria-current={page === "general" ? "page" : undefined}
              onClick={() => setPage("general")}
            >
              <NavIcon name="general" />
              <span>通用设置</span>
            </button>
            <button
              type="button"
              className={`console-nav__item${page === "globe" ? " is-active" : ""}`}
              aria-current={page === "globe" ? "page" : undefined}
              onClick={() => setPage("globe")}
            >
              <NavIcon name="globe" />
              <span>虚拟地球</span>
            </button>
          </nav>
          <div className="console-window-controls">
            <button
              type="button"
              className="console-window-btn"
              aria-label="最小化"
              title={desktop ? "最小化" : "在应用窗口中可用"}
              disabled={!desktop}
              onClick={minimize}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M5 12h14" />
              </svg>
            </button>
            <button
              type="button"
              className="console-window-btn"
              aria-label={maximized ? "还原" : "最大化"}
              title={
                desktop ? (maximized ? "还原" : "最大化") : "在应用窗口中可用"
              }
              disabled={!desktop}
              onClick={toggleMaximized}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                {maximized ? (
                  <path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5" />
                ) : (
                  <path d="M4 9V4h5M20 9V4h-5M20 15v5h-5M4 15v5h5" />
                )}
              </svg>
            </button>
            <button
              type="button"
              className="console-window-btn"
              aria-label="关闭"
              title={desktop ? "关闭" : "在应用窗口中可用"}
              disabled={!desktop}
              onClick={close}
            >
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>

        <main
          className={`console-content${page === "globe" ? " is-globe" : ""}`}
        >
            {page === "general" ? (
              <div className="console-settings">
                <div className="console-settings__head">
                  <p className="console-caption">两只桌宠分别设置</p>
                  <div className="console-appearance">
                    <div className="console-appearance__row">
                      <span className="console-appearance__label">底色</span>
                      <SegmentedControl
                        options={themeOptions}
                        value={theme}
                        onChange={applyTheme}
                        ariaLabel="底色"
                        className="console-segmented--theme console-segmented--capsule"
                      />
                    </div>
                    <div className="console-appearance__row">
                      <span className="console-appearance__label">材质</span>
                      <SegmentedControl
                        options={MATERIAL_OPTIONS}
                        value={material}
                        onChange={applyMaterial}
                        ariaLabel="材质"
                        className="console-segmented--theme console-segmented--capsule"
                      />
                    </div>
                  </div>
                </div>

                <div className="console-rows">
                  <section className="console-row console-row--mode">
                    <div className="console-row__head">
                      <h2>行为模式</h2>
                      <p>两只桌宠共用。虚拟地球开启后按当地太阳作息行动，覆盖下方档位。</p>
                    </div>
                    <SegmentedControl
                      options={MODE_OPTIONS}
                      value={mode}
                      onChange={setPetMode}
                      ariaLabel="行为模式"
                      className="console-segmented--capsule console-segmented--mode"
                    />
                    <div
                      className={`console-phase-reveal${
                        globeOverride ? " is-open" : ""
                      }`}
                      inert={!globeOverride}
                    >
                      <div className="console-phase-reveal__inner">
                        <PhaseRail
                          virtualDate={virtualDate}
                          onVirtualDateChange={setVirtualDate}
                          virtualMinute={virtualMinute}
                          onVirtualMinuteChange={setVirtualMinute}
                        />
                      </div>
                    </div>
                  </section>
                  {CHARACTERS.map((character, index) => (
                    <section
                      className={`console-row${globeOverride ? " is-locked" : ""}`}
                      key={character.key}
                    >
                      <div className="console-row__head">
                        <h2>{character.name}</h2>
                        <p>
                          {!ready
                            ? "读取设置…"
                            : globeOverride
                              ? "由虚拟地球作息接管"
                              : "自主行动的活跃程度"}
                        </p>
                        <VisibilityToggle
                          visible={visible[character.key]}
                          label={`显示${character.name}`}
                          disabled={!ready}
                          onChange={(next) =>
                            setCharVisible(character.key, next)
                          }
                        />
                      </div>
                      <div className="console-gear-cell">
                        <GearSlider
                          label={`${character.name}行为档位`}
                          value={gears[character.key]}
                          color={GEAR_BLUE}
                          inkColor={GEAR_INK[theme === "black" ? "black" : "white"]}
                          spring={GEAR_SPRING}
                          disabled={!ready || globeOverride}
                          onChange={(gear) => setCharGear(character.key, gear)}
                        />
                        {index === CHARACTERS.length - 1 ? (
                          <p className="console-gear-note">
                            档位只调节奏，活动范围始终是整块屏幕。
                          </p>
                        ) : null}
                      </div>
                    </section>
                  ))}
                  <section className="console-row console-row--outline">
                    <div className="console-row__head">
                      <h2>互动描边</h2>
                      <p>
                        {ready
                          ? "进入互动模式时，角色外圈显示基建界面同款黄色描边。"
                          : "读取设置…"}
                      </p>
                    </div>
                    <SegmentedControl
                      options={OUTLINE_OPTIONS}
                      value={outline ? "on" : "off"}
                      onChange={(next) => setInteractionOutline(next === "on")}
                      ariaLabel="互动描边"
                      className="console-segmented--capsule"
                    />
                  </section>
                  <section className="console-row console-row--outline">
                    <div className="console-row__head">
                      <h2>溜冰惯性</h2>
                      <p>
                        {ready
                          ? "开启后，互动模式里冲刺松手会像溜冰一样长距离滑行；关闭则干脆收住。"
                          : "读取设置…"}
                      </p>
                    </div>
                    <SegmentedControl
                      options={OUTLINE_OPTIONS}
                      value={iceGlide ? "on" : "off"}
                      onChange={(next) =>
                        setInteractionIceGlide(next === "on")
                      }
                      ariaLabel="溜冰惯性"
                      className="console-segmented--capsule"
                    />
                  </section>
                </div>
                <p className="console-license">
                  字体：HarmonyOS Sans（华为）· 许可见仓库 NOTICE.md
                </p>
              </div>
            ) : (
              <Suspense
                fallback={
                  <section
                    className="console-globe-page"
                    aria-label="虚拟地球"
                  />
                }
              >
                <GlobePage
                  desktop={desktop}
                  preview={config.preview}
                  virtualDate={virtualDate}
                  onVirtualDateChange={setVirtualDate}
                  virtualMinute={virtualMinute}
                  onVirtualMinuteChange={setVirtualMinute}
                />
              </Suspense>
            )}
        </main>
      </div>
    </div>
  );
}
