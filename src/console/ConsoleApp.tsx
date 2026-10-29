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
import type {
  AppLanguage,
  ConsoleMaterial,
  FrameRate,
  PetMode,
} from "../settings/store";
import { useI18n } from "../i18n";
import "./ConsoleApp.css";

// 语言名称使用各语言的自称，不随界面语言翻译。
const LANGUAGE_OPTIONS: Array<{ value: AppLanguage; label: string }> = [
  { value: "zh-CN", label: "简体中文" },
  { value: "en", label: "English" },
];

const GlobePage = lazy(() => import("./GlobePage"));

const DEFAULT_THICKNESS: ThicknessLevel = 2;
const GEAR_SPRING = { k: 600, c: 42 };
const GEAR_BLUE = "#3b82f6";
const GEAR_INK = { white: "#2563eb", black: "#60a5fa" } as const;

type ConsolePage = "general" | "globe";

// 语言切换时做平移动画的块。行内/区间元素会因中英文长度不同而移动：
// 日轨表头里的日期时间是被右侧“实时 · 时段 / 虚拟 [重置]”文字挤着走的，
// 单独列出来做 FLIP。
const LAYOUT_BLOCK_SELECTOR = [
  ".console-topbar h1",
  ".console-nav__item",
  ".console-settings__head",
  ".console-license",
  ".console-rows > *",
  ".console-phase-rail__clock",
].join(", ");

type LayoutBlock = {
  el: HTMLElement;
  left: number;
  top: number;
  /** 最近的、也在测量列表里的祖先；子块只补相对它的位移。 */
  ancestor: LayoutBlock | null;
};

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
  const { lang, t, setLanguage } = useI18n();
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
    frameRate,
    ready,
    setCharGear,
    setCharVisible,
    setPetMode,
    setInteractionOutline,
    setInteractionIceGlide,
    setFrameRate,
  } = useGearSettings();
  const globeOverride = mode === "time";
  const frameRateOptions: Array<{ value: FrameRate; label: string }> = [
    { value: "30", label: "30" },
    { value: "60", label: "60" },
    { value: "120", label: "120" },
    { value: "unlimited", label: t("frameRate.unlimited") },
  ];

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

  useEffect(() => {
    const title = t("app.consoleWindowTitle");
    document.title = title;
    winRef.current?.setTitle(title).catch((err) => {
      console.error("[console] title", err);
    });
  }, [desktop, lang, t]);

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

  // 语言切换：英文信息密度低，说明会折成两行把下方内容推下去；顶部栏的标题与
  // 导航项也会因中英文长度不同而左右移动。这里用 FLIP：先量旧位置，切语言后让
  // 每块从旧位置平移到新位置，不做淡入淡出。
  // 不用 ::view-transition 的整页快照——快照里包着“移动后”的画面，位移会被烘进
  // 静态图里，反而看不到移动；而且行高变化会让快照被拉伸。
  const measureLayoutBlocks = () => {
    const root = document.querySelector<HTMLElement>(".console-root");
    if (!root) return [];
    const blocks = root.querySelectorAll<HTMLElement>(LAYOUT_BLOCK_SELECTOR);
    const measured = new Map<HTMLElement, LayoutBlock>();
    const result: LayoutBlock[] = [];
    for (const el of blocks) {
      // 最近的、本身也在动画面板里的祖先：父块的 transform 会带着子块一起走，
      // 子块只需补“相对父块”的那一段位移（见 animateLayoutShift）。
      let ancestor: LayoutBlock | null = null;
      for (let node = el.parentElement; node; node = node.parentElement) {
        const hit = measured.get(node);
        if (hit) {
          ancestor = hit;
          break;
        }
      }
      const rect = el.getBoundingClientRect();
      const block: LayoutBlock = {
        el,
        left: rect.left,
        top: rect.top,
        ancestor,
      };
      measured.set(el, block);
      result.push(block);
    }
    return result;
  };

  const animateLayoutShift = (before: LayoutBlock[]) => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // 先把所有块的新位置量完再起动画：动画一旦起跑就会立刻把 transform 作用到
    // 元素上，后量的子块会读到被祖先 transform 拖走的坐标，多算一段位移。
    const full = new Map<HTMLElement, { dx: number; dy: number }>();
    for (const block of before) {
      if (!block.el.isConnected) {
        full.set(block.el, { dx: 0, dy: 0 });
        continue;
      }
      const rect = block.el.getBoundingClientRect();
      full.set(block.el, { dx: block.left - rect.left, dy: block.top - rect.top });
    }
    for (const block of before) {
      const own = full.get(block.el);
      if (!own) continue;
      // 父块和子块若各按自己的绝对位移做动画，父块的 translate 会再带子块走一
      // 遍，叠加成两倍；减掉祖先的位移后，子块只负责容器内部那一段。
      const base = block.ancestor ? full.get(block.ancestor.el) : undefined;
      const dx = own.dx - (base?.dx ?? 0);
      const dy = own.dy - (base?.dy ?? 0);
      if (Math.abs(dx) < 0.5 && Math.abs(dy) < 0.5) continue;
      // 从旧位置沿 transform 滑回新位置。用 Web Animations 而不是 inline
      // transition——动画结束不需要清理内联样式，连点也会自动接管当前视觉位置
      // （下一次测量读到的就是动画中的位置）。
      block.el.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)` },
          { transform: "translate(0px, 0px)" },
        ],
        { duration: 280, easing: "cubic-bezier(0.2, 0, 0.2, 1)" },
      );
    }
  };

  const applyLanguage = (next: AppLanguage) => {
    if (next === lang) return;
    const before = measureLayoutBlocks();
    flushSync(() => {
      void setLanguage(next);
    });
    animateLayoutShift(before);
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
  const themeOptions: Array<{ value: ThemeId; label: string }> = [
    {
      value: "white",
      label: material === "liquid" ? t("theme.porcelain") : t("theme.white"),
    },
    {
      value: "black",
      label: material === "liquid" ? t("theme.obsidian") : t("theme.black"),
    },
  ];
  const materialOptions: Array<{ value: ConsoleMaterial; label: string }> = [
    { value: "classic", label: t("material.classic") },
    { value: "liquid", label: t("material.liquid") },
  ];
  const modeOptions: Array<{ value: PetMode; label: string }> = [
    { value: "gear", label: t("mode.gear") },
    { value: "time", label: t("mode.globe") },
  ];
  const toggleOptions: Array<{ value: "on" | "off"; label: string }> = [
    { value: "on", label: t("toggle.on") },
    { value: "off", label: t("toggle.off") },
  ];

  return (
    <div
      className={`console-root${config.preview ? " is-preview" : ""}`}
      style={style}
      data-theme={theme}
      data-material={material}
      data-lang={lang}
      data-thick={DEFAULT_THICKNESS}
      data-renderer={rendererState}
      aria-label={t("app.consoleTitle")}
    >
      <div className="console-shell" ref={shellRef}>
        <canvas ref={canvasRef} className="glass-canvas" aria-hidden="true" />

        <div className="console-topbar">
          <div
            className="console-drag-region"
            data-tauri-drag-region={maximized ? undefined : true}
          >
            <h1>
              {t("app.consoleTitle")}
              <span className="console-preview-badge">{t("app.previewBadge")}</span>
            </h1>
          </div>
          <nav className="console-nav" aria-label={t("nav.aria")}>
            <button
              type="button"
              className={`console-nav__item${page === "general" ? " is-active" : ""}`}
              aria-current={page === "general" ? "page" : undefined}
              onClick={() => setPage("general")}
            >
              <NavIcon name="general" />
              <span>{t("nav.general")}</span>
            </button>
            <button
              type="button"
              className={`console-nav__item${page === "globe" ? " is-active" : ""}`}
              aria-current={page === "globe" ? "page" : undefined}
              onClick={() => setPage("globe")}
            >
              <NavIcon name="globe" />
              <span>{t("nav.globe")}</span>
            </button>
          </nav>
          <div className="console-window-controls">
            <button
              type="button"
              className="console-window-btn"
              aria-label={t("window.minimize")}
              title={
                desktop ? t("window.minimize") : t("window.desktopOnly")
              }
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
              aria-label={
                maximized ? t("window.restore") : t("window.maximize")
              }
              title={
                desktop
                  ? maximized
                    ? t("window.restore")
                    : t("window.maximize")
                  : t("window.desktopOnly")
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
              aria-label={t("window.close")}
              title={desktop ? t("window.close") : t("window.desktopOnly")}
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
                  <p className="console-caption">{t("settings.caption")}</p>
                  <div className="console-appearance">
                    <div className="console-appearance__row">
                      <span className="console-appearance__label">
                        {t("settings.background")}
                      </span>
                      <SegmentedControl
                        options={themeOptions}
                        value={theme}
                        onChange={applyTheme}
                        ariaLabel={t("settings.background")}
                        className="console-segmented--theme console-segmented--capsule"
                      />
                    </div>
                    <div className="console-appearance__row">
                      <span className="console-appearance__label">
                        {t("settings.material")}
                      </span>
                      <SegmentedControl
                        options={materialOptions}
                        value={material}
                        onChange={applyMaterial}
                        ariaLabel={t("settings.material")}
                        className="console-segmented--theme console-segmented--capsule"
                      />
                    </div>
                  </div>
                </div>

                <div className="console-rows">
                  <section className="console-row console-row--mode">
                    <div className="console-row__head">
                      <h2>{t("settings.language")}</h2>
                      <p>{t("settings.languageDesc")}</p>
                    </div>
                    <SegmentedControl
                      options={LANGUAGE_OPTIONS}
                      value={lang}
                      onChange={applyLanguage}
                      ariaLabel={t("settings.languageAria")}
                      className="console-segmented--capsule console-segmented--mode"
                    />
                  </section>
                  <section className="console-row console-row--mode">
                    <div className="console-row__head">
                      <h2>{t("settings.frameRate")}</h2>
                      <p>
                        {ready
                          ? t("settings.frameRateDesc")
                          : t("settings.loading")}
                      </p>
                    </div>
                    <SegmentedControl
                      options={frameRateOptions}
                      value={frameRate}
                      onChange={setFrameRate}
                      ariaLabel={t("settings.frameRate")}
                      className="console-segmented--capsule console-segmented--frame"
                    />
                  </section>
                  <section className="console-row console-row--mode">
                    <div className="console-row__head">
                      <h2>{t("mode.title")}</h2>
                      <p>{t("mode.desc")}</p>
                    </div>
                    <SegmentedControl
                      options={modeOptions}
                      value={mode}
                      onChange={setPetMode}
                      ariaLabel={t("mode.title")}
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
                  {CHARACTERS.map((character, index) => {
                    const name =
                      lang === "en" ? character.nameEn : character.name;
                    return (
                      <section
                        className={`console-row${globeOverride ? " is-locked" : ""}`}
                        key={character.key}
                      >
                        <div className="console-row__head">
                          <h2>{name}</h2>
                          <p>
                            {!ready
                              ? t("settings.loading")
                              : globeOverride
                                ? t("pet.locked")
                                : t("pet.activeHint")}
                          </p>
                          <VisibilityToggle
                            visible={visible[character.key]}
                            label={t("pet.show", { name })}
                            disabled={!ready}
                            onChange={(next) =>
                              setCharVisible(character.key, next)
                            }
                          />
                        </div>
                        <div className="console-gear-cell">
                          <GearSlider
                            label={t("pet.gearAria", { name })}
                            value={gears[character.key]}
                            color={GEAR_BLUE}
                            inkColor={
                              GEAR_INK[theme === "black" ? "black" : "white"]
                            }
                            spring={GEAR_SPRING}
                            disabled={!ready || globeOverride}
                            onChange={(gear) =>
                              setCharGear(character.key, gear)
                            }
                          />
                          {index === CHARACTERS.length - 1 ? (
                            <p className="console-gear-note">
                              {t("pet.gearNote")}
                            </p>
                          ) : null}
                        </div>
                      </section>
                    );
                  })}
                  <section className="console-row console-row--outline">
                    <div className="console-row__head">
                      <h2>{t("interaction.outline")}</h2>
                      <p>
                        {ready
                          ? t("interaction.outlineDesc")
                          : t("settings.loading")}
                      </p>
                    </div>
                    <SegmentedControl
                      options={toggleOptions}
                      value={outline ? "on" : "off"}
                      onChange={(next) => setInteractionOutline(next === "on")}
                      ariaLabel={t("interaction.outline")}
                      className="console-segmented--capsule"
                    />
                  </section>
                  <section className="console-row console-row--outline">
                    <div className="console-row__head">
                      <h2>{t("interaction.glide")}</h2>
                      <p>
                        {ready
                          ? t("interaction.glideDesc")
                          : t("settings.loading")}
                      </p>
                    </div>
                    <SegmentedControl
                      options={toggleOptions}
                      value={iceGlide ? "on" : "off"}
                      onChange={(next) =>
                        setInteractionIceGlide(next === "on")
                      }
                      ariaLabel={t("interaction.glide")}
                      className="console-segmented--capsule"
                    />
                  </section>
                </div>
                <p className="console-license">{t("license.font")}</p>
              </div>
            ) : (
              <Suspense
                fallback={
                  <section
                    className="console-globe-page"
                    aria-label={t("globe.pageAria")}
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
