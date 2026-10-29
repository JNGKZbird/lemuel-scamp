import { useEffect, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalPosition } from "@tauri-apps/api/dpi";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { load_model, SpineWebGLRenderer } from "./spine38/webgl-renderer";
import {
  cancelMovement,
  contentWindowBounds,
  createMovementState,
  mulberry32,
  pickWalk,
  resolveMoveOptions,
  setMovementPosition,
  stepMovement,
} from "./pet/movement.ts";
import type {
  Bounds as MoveBounds,
  MoveOptions,
  MovementState,
} from "./pet/movement.ts";
import { getLogicalWorkArea } from "./platform/workArea.ts";
import {
  isBehaviorProbeEnabled,
  writeBehaviorProbe,
} from "./platform/behaviorProbe.ts";
import {
  getConsoleMaterial,
  getConsoleTheme,
  getGear,
  getLocation,
  getMode,
  getVirtualTime,
  initSettings,
  subscribeGear,
  subscribeLocation,
  subscribeMode,
  subscribeVirtualTime,
} from "./settings/store";
import { ensureConsole } from "./console/openConsole";
import type {
  Gear,
  GeoLocation,
  PetMode,
  VirtualTime,
} from "./settings/store";
import {
  dateAtParts,
  datePartsFromDate,
  parseIsoDate,
} from "./pet/calendar.ts";
import { GEAR_PRESETS } from "./pet/behavior-presets.ts";
import type { Behavior } from "./pet/behavior-presets.ts";
import { CHARS, TURN_SECONDS } from "./pet/characters.ts";
import type { CharKey } from "./pet/characters.ts";
import { getPhase } from "./pet/solar.ts";
import type { PhaseId } from "./pet/solar.ts";
import { allowsSleep, getPhaseBehavior } from "./pet/phase-behavior.ts";
import "./App.css";

const charKey: CharKey =
  new URLSearchParams(location.search).get("char") === "angel" ? "angel" : "angel2";
const MODEL = CHARS[charKey];

type PetActivity = "idle" | "walk" | "turn" | "poke" | "sit" | "sleep";

// 2026-10-23 A/B：横向-only 稳定性排查；排查后恢复 false。
const HORIZONTAL_ONLY_DIAGNOSTIC = false;
// 2026-10-23 A/B：完整 2D，但窗口整体夹在工作区内；排查后决定是否保留。
const CLAMP_WINDOW_Y_DIAGNOSTIC = true;

// 行为档位（总控台调整；每角色独立；活动范围一律整块屏幕）


const rand = (a: number, b: number) => a + Math.random() * (b - a);

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const [appWindow] = useState(() => getCurrentWindow());

  const gearRef = useRef<Gear>("standard");
  const modeRef = useRef<PetMode>("gear");
  const virtualTimeRef = useRef<VirtualTime | null>(null);
  const virtualTimeDirtyRef = useRef(false);
  const locationRef = useRef<GeoLocation>({
    lat: 39.9042,
    lon: 116.4074,
    isDefault: true,
  });
  const [settingsReady, setSettingsReady] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuOpenRef = useRef(false);
  const [menuPos, setMenuPos] = useState({ x: 8, y: 8 });

  useEffect(() => {
    menuOpenRef.current = menuOpen;
  }, [menuOpen]);

  // 设置读取期间也保证关闭按钮可点，避免角色窗暂时完全穿透
  useEffect(() => {
    const btn = document.querySelector(".close-btn")?.getBoundingClientRect();
    if (!btn) return;
    invoke("set_hit_boxes", {
      boxes: [[btn.left, btn.top, btn.width, btn.height]],
    }).catch(() => {});
  }, []);

  // 启动时读取统一设置（并迁移旧 localStorage 档位）
  useEffect(() => {
    let alive = true;
    const unlisteners: UnlistenFn[] = [];
    (async () => {
      try {
        await initSettings();
        const storedGear = await getGear(charKey);
        const storedMode = await getMode();
        const storedLocation = await getLocation();
        const storedVirtual = await getVirtualTime();
        if (!alive) return;
        gearRef.current = storedGear;
        modeRef.current = storedMode;
        locationRef.current = storedLocation;
        virtualTimeRef.current = storedVirtual;

        const unlistenGear = await subscribeGear(charKey, (next) => {
          gearRef.current = next;
        });
        const unlistenMode = await subscribeMode((next) => {
          modeRef.current = next;
        });
        const unlistenLocation = await subscribeLocation((next) => {
          locationRef.current = next;
        });
        const unlistenVirtual = await subscribeVirtualTime((next) => {
          virtualTimeRef.current = next;
          virtualTimeDirtyRef.current = true;
        });
        if (!alive) {
          unlistenGear();
          unlistenMode();
          unlistenLocation();
          unlistenVirtual();
          return;
        }
        unlisteners.push(
          unlistenGear,
          unlistenMode,
          unlistenLocation,
          unlistenVirtual,
        );
      } catch (err) {
        console.error("[settings]", err);
      } finally {
        if (alive) setSettingsReady(true);
      }
    })();
    return () => {
      alive = false;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [appWindow]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (menuOpenRef.current) {
          setMenuOpen(false);
          return;
        }
        appWindow.close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [appWindow]);

  // 平权双窗：入口窗（angel2）负责拉起同伴窗（angel），之后两窗互不隶属
  useEffect(() => {
    if (appWindow.label !== "angel2") return;
    let cancelled = false;
    (async () => {
      const all = await getAllWebviewWindows();
      if (cancelled || all.some((w) => w.label === "angel")) return;
      const scale = await appWindow.scaleFactor();
      const pos = await appWindow.outerPosition();
      if (cancelled) return;
      const peer = new WebviewWindow("angel", {
        url: "/?char=angel",
        title: CHARS.angel.title,
        width: 260,
        height: 280,
        x: Math.max(0, Math.round(pos.x / scale) - 290),
        y: Math.round(pos.y / scale),
        transparent: true,
        decorations: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        shadow: false,
        resizable: false,
        maximizable: false,
        minimizable: false,
        focus: false,
      });
      peer.once("tauri://error", (e) => console.error("[peer]", e));
    })().catch((err) => console.error("[peer]", err));
    return () => {
      cancelled = true;
    };
  }, [appWindow]);

  // 启动时让 console 随桌宠出现；不抢焦点。
  useEffect(() => {
    if (appWindow.label !== "angel2") return;
    let cancelled = false;
    (async () => {
      try {
        await initSettings();
        const [theme, material] = await Promise.all([
          getConsoleTheme(),
          getConsoleMaterial(),
        ]);
        if (!cancelled) await ensureConsole(theme, material, { focus: false });
      } catch (err) {
        console.error("[console]", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [appWindow]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("blur", close);
    return () => window.removeEventListener("blur", close);
  }, [menuOpen]);

  useEffect(() => {
    if (!menuOpen) return;
    const raf = requestAnimationFrame(() => {
      const boxes: number[][] = [];
      const btn = document.querySelector(".close-btn")?.getBoundingClientRect();
      if (btn) boxes.push([btn.left, btn.top, btn.width, btn.height]);
      const menu = document.querySelector(".pet-menu")?.getBoundingClientRect();
      if (menu) boxes.push([menu.left, menu.top, menu.width, menu.height]);
      invoke("set_hit_boxes", { boxes }).catch(() => {});
    });
    return () => cancelAnimationFrame(raf);
  }, [menuOpen]);

  const openMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const target = event.target as Element | null;
    if (target?.closest(".close-btn") || target?.closest(".pet-menu")) return;
    const rect = stageRef.current?.getBoundingClientRect();
    const width = 150;
    const height = 44;
    const left = rect?.left ?? 0;
    const top = rect?.top ?? 0;
    const maxX = (rect?.width ?? 260) - width - 4;
    const maxY = (rect?.height ?? 280) - height - 4;
    setMenuPos({
      x: Math.max(4, Math.min(maxX, event.clientX - left)),
      y: Math.max(4, Math.min(maxY, event.clientY - top)),
    });
    setMenuOpen(true);
  };

  const openConsoleFromMenu = async () => {
    setMenuOpen(false);
    try {
      await initSettings();
      const [theme, material] = await Promise.all([
        getConsoleTheme(),
        getConsoleMaterial(),
      ]);
      await ensureConsole(theme, material, { focus: true });
    } catch (err) {
      console.error("[console]", err);
    }
  };

  useEffect(() => {
    if (!settingsReady) return;
    const canvas = canvasRef.current;
    const stage = stageRef.current;
    if (!canvas || !stage) return;
    let raf = 0;
    let disposed = false;
    const cleanup: Array<() => void> = [];

    (async () => {
      const btn0 = document.querySelector(".close-btn")?.getBoundingClientRect();
      if (btn0) {
        invoke("set_hit_boxes", {
          boxes: [[btn0.left, btn0.top, btn0.width, btn0.height]],
        }).catch(() => {});
      }

      const model = await load_model(MODEL.dir, MODEL.name);
      if (disposed) return;
      const renderer = new SpineWebGLRenderer(canvas);
      await renderer.set_model(model, MODEL.dir);
      if (disposed) return;

      // 官方基建过渡口径（2.7.81）：Relax↔Move 与 Sit/Sleep 进出 = 0.2s 交叉淡化；
      // Interact / Special = 0s 硬切（片段首尾与待机姿态对齐）。
      const MIX = 0.2;
      const play = (name: string, loop = true, restart = false, mix?: number) => {
        const prev = renderer.current_animation_name();
        const m =
          mix !== undefined
            ? mix
            : name === "Move" || name === "Sit" || name === "Sleep"
              ? MIX
              : name === "Relax"
                ? prev === "Move" || prev === "Sit" || prev === "Sleep"
                  ? MIX
                  : 0
                : 0;
        renderer.set_animation(name, loop, restart, m);
      };

      const scale = await appWindow.scaleFactor();
      const pos = await appWindow.outerPosition();
      const startPos = { x: pos.x / scale, y: pos.y / scale };

      // 正式走速 = 触地段速度 × 显示缩放（与渲染器同一口径：发顶高＝屏高×16.3%）
      const modelH = Math.max(1, model.body.head_y - model.body.ground_y);
      const displayH = Math.min(window.screen.height * 0.163, 280 * 0.9);
      const walkSpeed = MODEL.stance * (displayH / modelH);

      const moveOptions: MoveOptions = resolveMoveOptions({
        slopeK: HORIZONTAL_ONLY_DIAGNOSTIC ? 0 : 1 / 3,
        speed: walkSpeed,
        turnSeconds: TURN_SECONDS,
      });

      let workArea: MoveBounds = {
        left: 0,
        top: 0,
        right: window.screen.availWidth,
        bottom: window.screen.availHeight,
      };
      const logicalWorkArea = await getLogicalWorkArea();
      if (logicalWorkArea) workArea = logicalWorkArea;
      else console.warn("[movement] work area fallback to window.screen");

      const contentFallback: MoveBounds = {
        left: 0,
        top: 0,
        right: 260,
        bottom: 280,
      };
      const currentContent = (): MoveBounds => {
        const b = renderer.content_bounds_css();
        return b.right > b.left && b.bottom > b.top ? b : contentFallback;
      };
      const clampWindowY = (bounds: MoveBounds): MoveBounds => {
        if (!CLAMP_WINDOW_Y_DIAGNOSTIC) return bounds;
        const top = Math.max(bounds.top, workArea.top);
        const bottom = Math.min(
          bounds.bottom,
          workArea.bottom - 280,
        );
        if (top > bottom) {
          return {
            ...bounds,
            top: workArea.top,
            bottom: Math.max(workArea.top, workArea.bottom - 280),
          };
        }
        return { ...bounds, top, bottom };
      };
      let walkBounds = clampWindowY(
        contentWindowBounds(
          workArea,
          currentContent(),
          moveOptions.marginX,
          moveOptions.marginY,
        ),
      );
      const refreshWalkBounds = () => {
        walkBounds = clampWindowY(
          contentWindowBounds(
            workArea,
            currentContent(),
            moveOptions.marginX,
            moveOptions.marginY,
          ),
        );
      };
      const refreshWorkArea = async () => {
        const next = await getLogicalWorkArea();
        if (next) workArea = next;
        refreshWalkBounds();
      };

      const seed =
        (Date.now() ^
          (appWindow.label === "angel" ? 0x9e3779b9 : 0x85ebca6b)) >>>
        0;
      const rng = mulberry32(seed);

      const hasSit = model.animations.some((a) => a.name === "Sit");
      const hasSleep = model.animations.some((a) => a.name === "Sleep");
      const sitAnim = model.animations.find((a) => a.name === "Sit");
      const SIT_SECONDS = sitAnim ? Math.max(1, sitAnim.duration) : 3;
      const pokeAnim = model.animations.find((a) => a.name === "Interact");
      const POKE_SECONDS = pokeAnim ? pokeAnim.duration : 1.5;

      const behaviorNow = (): Date => {
        const virtual = virtualTimeRef.current;
        if (
          modeRef.current !== "time" ||
          !virtual ||
          (virtual.date === null && virtual.minute === null)
        ) {
          return new Date();
        }
        const now = new Date();
        const parts = virtual.date ? parseIsoDate(virtual.date) : null;
        const base = parts ?? datePartsFromDate(now);
        const minute =
          virtual.minute ??
          now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
        return dateAtParts(base, minute);
      };

      const pres = (): Behavior => {
        if (modeRef.current === "time") {
          const info = getPhase(
            behaviorNow(),
            locationRef.current.lat,
            locationRef.current.lon,
          );
          return getPhaseBehavior(
            info.phase,
            info.solar.dayLengthMs / 3_600_000,
          );
        }
        return GEAR_PRESETS[gearRef.current];
      };

      let mode: PetActivity = "idle";
      let idleTime = 0;
      let idleLimit = rand(pres().idleMin, pres().idleMax);
      let pokeT = 0;
      let sitTime = 0;
      let sleepTime = 0;
      let sleepLimit = 0;
      let move: MovementState = createMovementState(
        startPos,
        walkBounds,
        seed,
        moveOptions,
      );
      let lastSentX = Math.round(startPos.x);
      let lastSentY = Math.round(startPos.y);
      let lastPhase: PhaseId | null =
        modeRef.current === "time"
          ? getPhase(
              behaviorNow(),
              locationRef.current.lat,
              locationRef.current.lon,
            ).phase
          : null;
      let lastPhaseCheck = -Infinity;

      let dragging = false;
      let dragOffX = 0;
      let dragOffY = 0;
      let downX = 0;
      let downY = 0;
      let downAt = 0;
      let moved = false;
      let pending = false;
      let last = performance.now();

      const probeOn = isBehaviorProbeEnabled();
      const probeLabel = appWindow.label;
      let probeMode: PetActivity = mode;
      let probeGear = gearRef.current;
      let probePetMode = modeRef.current;
      let probeStart = performance.now();
      let probeStartPos = { ...move.pos };
      let probePhase: PhaseId | null =
        modeRef.current === "time"
          ? getPhase(
              behaviorNow(),
              locationRef.current.lat,
              locationRef.current.lon,
            ).phase
          : null;
      let probeTarget: "local" | "global" | null = null;

      const probePhaseNow = (): PhaseId | null =>
        modeRef.current === "time"
          ? getPhase(
              behaviorNow(),
              locationRef.current.lat,
              locationRef.current.lon,
            ).phase
          : null;

      const emitProbeSegment = (
        segmentMode: PetActivity,
        durationMs: number,
        segmentPhase: PhaseId | null,
        segmentTarget: "local" | "global" | null,
      ) => {
        if (!probeOn) return;
        writeBehaviorProbe(probeLabel, {
          type: "segment",
          mode: segmentMode,
          durationMs: Math.max(0, Math.round(durationMs)),
          wallEnd: new Date().toISOString(),
          phase: segmentPhase,
          petMode: probePetMode,
          gear: probeGear,
          x0: probeStartPos.x,
          y0: probeStartPos.y,
          x1: move.pos.x,
          y1: move.pos.y,
          target: segmentTarget,
        });
      };

      const flushProbe = (nextMode: PetActivity, at: number) => {
        emitProbeSegment(probeMode, at - probeStart, probePhase, probeTarget);
        probeMode = nextMode;
        probeStart = at;
        probeStartPos = { ...move.pos };
        probePhase = probePhaseNow();
        probeGear = gearRef.current;
        probePetMode = modeRef.current;
        probeTarget =
          nextMode === "walk" || nextMode === "turn"
            ? (move.target?.tier ?? null)
            : null;
      };

      const flushProbeCurrent = () => {
        emitProbeSegment(
          probeMode,
          performance.now() - probeStart,
          probePhase,
          probeTarget,
        );
      };

      if (probeOn) {
        writeBehaviorProbe(probeLabel, {
          type: "start",
          wall: new Date().toISOString(),
          phase: probePhase,
          petMode: probePetMode,
          gear: probeGear,
          x: move.pos.x,
          y: move.pos.y,
          workArea,
          speed: moveOptions.speed,
          slopeK: moveOptions.slopeK,
        });
        window.addEventListener("beforeunload", flushProbeCurrent);
        cleanup.push(() =>
          window.removeEventListener("beforeunload", flushProbeCurrent),
        );
      }

      const pushMove = () => {
        const nx = Math.round(move.pos.x);
        const ny = Math.round(move.pos.y);
        if (pending || (nx === lastSentX && ny === lastSentY)) return;
        pending = true;
        appWindow
          .setPosition(new LogicalPosition(nx, ny))
          .then(() => {
            lastSentX = nx;
            lastSentY = ny;
          })
          .catch(() => {})
          .finally(() => {
            pending = false;
          });
      };

      const toIdle = () => {
        move = cancelMovement(move, true);
        renderer.set_yaw(move.yaw);
        mode = "idle";
        idleTime = 0;
        idleLimit = rand(pres().idleMin, pres().idleMax);
      };

      const pickNext = () => {
        const p = pres();
        const roll = Math.random();
        if (roll < p.pWalk) {
          refreshWalkBounds();
          const next = pickWalk(move, walkBounds, rng, moveOptions);
          if (!next) {
            toIdle();
            return;
          }
          move = next;
          mode = move.phase === "turn" ? "turn" : "walk";
        } else if (hasSit && roll < p.pWalk + p.pSit) {
          mode = "sit";
          sitTime = 0;
        } else if (hasSleep && roll < p.pWalk + p.pSit + p.pSleep) {
          mode = "sleep";
          sleepTime = 0;
          sleepLimit = rand(p.sleepMin, p.sleepMax);
        } else {
          toIdle();
        }
      };

      // 控制权归属：指针按下＝用户接管（暂停自主行为），松开＝回到生活
      const onDown = (e: PointerEvent) => {
        if (e.button !== 0) return;
        if ((e.target as HTMLElement | null)?.closest(".close-btn")) return;
        if ((e.target as HTMLElement | null)?.closest(".pet-menu")) return;
        if (menuOpenRef.current) {
          setMenuOpen(false);
          return;
        }
        dragging = true;
        toIdle();
        dragOffX = e.screenX - move.pos.x;
        dragOffY = e.screenY - move.pos.y;
        downX = e.screenX;
        downY = e.screenY;
        downAt = performance.now();
        moved = false;
        stage.setPointerCapture?.(e.pointerId);
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        if (!moved) {
          if (Math.hypot(e.screenX - downX, e.screenY - downY) < 4) return;
          moved = true;
        }
        move = setMovementPosition(move, {
          x: e.screenX - dragOffX,
          y: e.screenY - dragOffY,
        });
        pushMove();
      };
      const onUp = () => {
        if (!dragging) return;
        dragging = false;
        if (!moved && performance.now() - downAt < 600) {
          mode = "poke";
          pokeT = 0;
          play("Interact", false, true);
        } else {
          toIdle();
        }
        void refreshWorkArea();
      };
      stage.addEventListener("pointerdown", onDown);
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      cleanup.push(() => {
        stage.removeEventListener("pointerdown", onDown);
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      });

      let unlistenScale: UnlistenFn | null = null;
      void appWindow
        .onScaleChanged(() => {
          void refreshWorkArea();
        })
        .then((fn) => {
          if (disposed) fn();
          else unlistenScale = fn;
        })
        .catch(() => {});
      cleanup.push(() => {
        unlistenScale?.();
      });

      const tick = (now: number) => {
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;

        if (modeRef.current === "time") {
          if (now - lastPhaseCheck > 10_000 || virtualTimeDirtyRef.current) {
            virtualTimeDirtyRef.current = false;
            lastPhaseCheck = now;
            const info = getPhase(
              behaviorNow(),
              locationRef.current.lat,
              locationRef.current.lon,
            );
            if (lastPhase === null) {
              lastPhase = info.phase;
              if (mode === "sleep" && !allowsSleep(info.phase)) {
                toIdle();
              }
            } else if (info.phase !== lastPhase) {
              if (mode === "sleep" && !allowsSleep(info.phase)) {
                toIdle();
              }
              lastPhase = info.phase;
            }
          }
        } else {
          lastPhase = null;
          lastPhaseCheck = -Infinity;
        }

        if (dragging) {
          play("Relax");
        } else if (mode === "poke") {
          pokeT += dt;
          if (pokeT >= POKE_SECONDS) toIdle();
        } else if (mode === "walk" || mode === "turn") {
          const result = stepMovement(move, dt, walkBounds, moveOptions);
          move = result.state;
          renderer.set_yaw(move.yaw);
          play("Move");
          if (
            result.event === "arrived" ||
            result.event === "blocked" ||
            move.phase === "idle"
          ) {
            toIdle();
          } else {
            mode = move.phase === "turn" ? "turn" : "walk";
          }
        } else if (mode === "sit") {
          play("Sit", true);
          sitTime += dt;
          if (sitTime >= SIT_SECONDS) toIdle();
        } else if (mode === "sleep") {
          play("Sleep", true);
          sleepTime += dt;
          if (sleepTime >= sleepLimit) toIdle();
        } else {
          play("Relax");
          idleTime += dt;
          if (idleTime >= idleLimit) pickNext();
        }

        if (probeOn && mode !== probeMode) {
          flushProbe(mode, performance.now());
        } else if (
          probeOn &&
          (mode === "walk" || mode === "turn") &&
          probeTarget === null
        ) {
          probeTarget = move.target?.tier ?? null;
        }

        if (!dragging) pushMove();
        renderer.draw();

        // 点击穿透：把可见内容包围（留 3px 余量）＋关闭按钮推给 Rust 做命中判定
        const b = renderer.content_bounds_css();
        const cr = canvas.getBoundingClientRect();
        const boxes: number[][] = [];
        if (b.right > b.left) {
          const pad = 3;
          boxes.push([
            cr.left + b.left - pad,
            cr.top + b.top - pad,
            b.right - b.left + pad * 2,
            b.bottom - b.top + pad * 2,
          ]);
        }
        if (dragging) boxes.push([cr.left, cr.top, cr.width, cr.height]);
        const btn = document.querySelector(".close-btn")?.getBoundingClientRect();
        if (btn) boxes.push([btn.left, btn.top, btn.width, btn.height]);
        const menu = document.querySelector(".pet-menu")?.getBoundingClientRect();
        if (menu) boxes.push([menu.left, menu.top, menu.width, menu.height]);
        invoke("set_hit_boxes", { boxes }).catch(() => {});

        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })().catch((err) => {
      console.error("[spine]", err);
      const el = document.getElementById("pet-error");
      if (el) el.textContent = String(err);
      const btn = document.querySelector(".close-btn")?.getBoundingClientRect();
      if (btn) {
        invoke("set_hit_boxes", {
          boxes: [[btn.left, btn.top, btn.width, btn.height]],
        }).catch(() => {});
      }
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      for (const fn of cleanup) fn();
    };
  }, [appWindow, settingsReady]);

  return (
    <div className="pet-stage" ref={stageRef} onContextMenu={openMenu}>
      <canvas ref={canvasRef} className="pet-canvas" />
      <div id="pet-error" className="pet-error" />
      {menuOpen ? (
        <div className="pet-menu" style={{ left: menuPos.x, top: menuPos.y }}>
          <button type="button" onClick={openConsoleFromMenu}>
            打开主控台
          </button>
        </div>
      ) : null}
      <button className="close-btn" title="退出" onClick={() => appWindow.close()}>
        ✕
      </button>
    </div>
  );
}
