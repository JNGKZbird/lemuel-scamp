import { useEffect, useRef, useState } from "react";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { load_model, SpineWebGLRenderer } from "../spine38/webgl-renderer";
import {
  CHARS,
  MODEL_WORLD_SCALE,
  TURN_SECONDS,
  initAssetBaseFromStatus,
  modelDir,
} from "../pet/characters.ts";
import type { CharKey } from "../pet/characters.ts";
import {
  PetController,
} from "../pet/petController.ts";
import type { SharedPetSettings } from "../pet/petController.ts";
import {
  contentWindowBounds,
  mulberry32,
  resolveMoveOptions,
} from "../pet/movement.ts";
import type { Bounds } from "../pet/movement.ts";
import {
  getCharacterVisible,
  getConsoleMaterial,
  getConsoleTheme,
  getGear,
  getFrameRate,
  getInteractionIceGlide,
  getInteractionOutline,
  getLocation,
  getMode,
  getVirtualTime,
  initSettings,
  reloadSettingsFromDisk,
  setCharacterVisible,
  subscribeCharacterVisible,
  subscribeFrameRate,
  subscribeGear,
  subscribeInteractionIceGlide,
  subscribeInteractionOutline,
  subscribeLocation,
  subscribeMode,
  subscribeVirtualTime,
} from "../settings/store";
import type { FrameRate } from "../settings/store";
import { ensureConsole } from "../console/openConsole";
import { useI18n } from "../i18n";
import "./overlay.css";

type MenuState = { key: CharKey; x: number; y: number } | null;

const CANVAS_W = 260;
const CANVAS_H = 280;
// 边界口径：角色的 Spine 网格（可见槽位）碰到屏幕边缘即边界，不留设计边距。
const MARGIN_X = 0;
const MARGIN_Y = 0;
const MENU_W = 150;

// 帧率上限换算成最小帧间隔；unlimited 返回 0 = 不跳帧，rAF 原速（跟随屏幕刷新率）。
// 减 1.5ms 的余量：60Hz 屏幕上 rAF 间隔约 16.7ms，不能被误判成“还没到点”。
function frameMinMs(rate: FrameRate): number {
  if (rate === "unlimited") return 0;
  return 1000 / Number(rate) - 1.5;
}
const MENU_H = 132;
const NEAR_PX = 80;

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

export default function OverlayPoc() {
  const { t } = useI18n();
  const stageRef = useRef<HTMLDivElement>(null);
  const angelCanvasRef = useRef<HTMLCanvasElement>(null);
  const angel2CanvasRef = useRef<HTMLCanvasElement>(null);
  const angelWrapRef = useRef<HTMLDivElement>(null);
  const angel2WrapRef = useRef<HTMLDivElement>(null);
  const controllersRef = useRef<Partial<Record<CharKey, PetController>>>({});
  const visibleRef = useRef<Record<CharKey, boolean>>({
    angel: true,
    angel2: true,
  });
  const menuRef = useRef<MenuState>(null);
  const boxesDirtyRef = useRef(true);
  const controlledRef = useRef<CharKey | null>(null);
  // 当前帧率上限换算出的最小帧间隔（ms）；0 = 不限制。
  const frameMinMsRef = useRef<number>(frameMinMs("60"));
  const keysRef = useRef<Set<string>>(new Set());
  const promptRef = useRef<HTMLDivElement>(null);
  const promptTargetRef = useRef<{ key: CharKey; x: number; y: number } | null>(
    null,
  );
  const actionsRef = useRef<{
    interact: (key: CharKey) => void;
    hide: (key: CharKey) => void;
    openConsole: () => void;
  }>({
    interact: () => {},
    hide: () => {},
    openConsole: () => {},
  });
  const [controlled, setControlled] = useState<CharKey | null>(null);
  const [menu, setMenu] = useState<MenuState>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const title = t("app.overlayWindowTitle");
    document.title = title;
    if (!isTauri()) return;
    getCurrentWindow()
      .setTitle(title)
      .catch((err) => console.error("[overlay] title", err));
  }, [t]);

  const setMenuSafe = (next: MenuState) => {
    menuRef.current = next;
    setMenu(next);
    boxesDirtyRef.current = true;
  };

  useEffect(() => {
    let disposed = false;
    let raf = 0;
    let dragKey: CharKey | null = null;
    let dragPointerId: number | null = null;
    let dragLockFallback = false;
    let dragLockTimer = 0;
    let lastBoxAt = 0;
    // 窗口区域的“可见框”要跟着运动走：区域更新比画面慢一拍，
    // 高速移动时得按速度补 padding，否则角色前缘会被窗口区域裁掉。
    const speeds: Record<CharKey, number> = { angel: 0, angel2: 0 };
    const lastPos: Record<CharKey, { x: number; y: number }> = {
      angel: { x: 0, y: 0 },
      angel2: { x: 0, y: 0 },
    };
    const posReady: Record<CharKey, boolean> = { angel: false, angel2: false };
    const regionPad = (speed: number) => Math.min(40, 6 + speed * 0.04);
    let lastPokeAt = 0;
    const cleanup: Array<() => void> = [];
    const stage = stageRef.current;
    const angelCanvas = angelCanvasRef.current;
    const angel2Canvas = angel2CanvasRef.current;
    const angelWrap = angelWrapRef.current;
    const angel2Wrap = angel2WrapRef.current;
    if (
      !stage ||
      !angelCanvas ||
      !angel2Canvas ||
      !angelWrap ||
      !angel2Wrap
    ) {
      return;
    }

    const wrappers: Record<CharKey, HTMLDivElement> = {
      angel: angelWrap,
      angel2: angel2Wrap,
    };
    const canvases: Record<CharKey, HTMLCanvasElement> = {
      angel: angelCanvas,
      angel2: angel2Canvas,
    };

    (async () => {
      await initSettings();
      const [
        gearAngel,
        gearAngel2,
        mode,
        location,
        virtualTime,
        visibleAngel,
        visibleAngel2,
        outline,
        iceGlide,
        frameRate,
      ] = await Promise.all([
        getGear("angel"),
        getGear("angel2"),
        getMode(),
        getLocation(),
        getVirtualTime(),
        getCharacterVisible("angel"),
        getCharacterVisible("angel2"),
        getInteractionOutline(),
        getInteractionIceGlide(),
        getFrameRate(),
      ]);
      if (disposed) return;
      frameMinMsRef.current = frameMinMs(frameRate);

      const shared: SharedPetSettings = {
        mode,
        location,
        virtualTime,
        virtualEpoch: 0,
      };
      const initialVisible: Record<CharKey, boolean> = {
        angel: visibleAngel,
        angel2: visibleAngel2,
      };
      visibleRef.current = initialVisible;

      // 可见性事件在模型加载前就订阅：加载期间总控台切换显示不能丢。
      // 控制器尚未创建时先记进 desiredVisible，创建时按最新值初始化。
      const desiredVisible: Record<CharKey, boolean> = { ...initialVisible };
      let applyLive: ((key: CharKey, next: boolean) => void) | null = null;
      const onVisibility = (key: CharKey, next: boolean) => {
        desiredVisible[key] = next;
        applyLive?.(key, next);
      };
      const unsubscribe = async (fn: () => Promise<UnlistenFn>) => {
        const unlisten = await fn();
        if (disposed) unlisten();
        else cleanup.push(unlisten);
      };
      await unsubscribe(() =>
        subscribeCharacterVisible("angel", (next) => onVisibility("angel", next)),
      );
      await unsubscribe(() =>
        subscribeCharacterVisible("angel2", (next) =>
          onVisibility("angel2", next),
        ),
      );
      if (disposed) return;

      const viewW = stage.clientWidth || window.innerWidth;
      const viewH = stage.clientHeight || window.innerHeight;
      let walkBounds = contentWindowBounds(
        { left: 0, top: 0, right: viewW, bottom: viewH },
        { left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H },
        MARGIN_X,
        MARGIN_Y,
      );
      const displayH = Math.min(
        window.screen.height * 0.163,
        CANVAS_H * 0.9,
      );

      const keys: CharKey[] = ["angel2", "angel"];
      const gears: Record<CharKey, "quiet" | "standard" | "active"> = {
        angel: gearAngel,
        angel2: gearAngel2,
      };
      // 活动范围按该角色当前渲染出的 Spine 内容计算，而不是整块 260×280 画布。
      const boundsFromContent = (key: CharKey): Bounds | null => {
        const content = controllersRef.current[key]?.contentBox();
        if (!content) return null;
        const w = stage.clientWidth || window.innerWidth;
        const h = stage.clientHeight || window.innerHeight;
        return contentWindowBounds(
          { left: 0, top: 0, right: w, bottom: h },
          content,
          MARGIN_X,
          MARGIN_Y,
        );
      };

      // 已安装素材走 asset 协议；dev 构建继续读同源 /models。
      await initAssetBaseFromStatus();
      if (disposed) return;

      for (const key of keys) {
        const dir = modelDir(key);
        const model = await load_model(dir, CHARS[key].name);
        if (disposed) return;
        const renderer = new SpineWebGLRenderer(canvases[key]);
        await renderer.set_model(model, dir);
        if (disposed) return;

        const modelH = Math.max(1, model.body.head_y - model.body.ground_y);
        const options = resolveMoveOptions({
          slopeK: 1 / 3,
          speed: CHARS[key].stance * (displayH / modelH),
          turnSeconds: TURN_SECONDS,
        });
        // 先换算成与分辨率无关的“身高/秒”：骨架单位 × 0.0018 = 世界单位，
        // controlSpeed 是世界单位/秒，除以世界身高即每秒几个身高。
        const sprintBodyHeightsPerSecond =
          CHARS[key].controlSpeed / (modelH * MODEL_WORLD_SCALE);
        // 再乘当前屏幕上的身高（CSS px）。displayH 与渲染器缩放口径同源，
        // 因此不同分辨率/DPI 下 px/s 会变，但“身高/秒”恒定。
        const sprintSpeed = sprintBodyHeightsPerSecond * displayH;
        const sit = model.animations.find((a) => a.name === "Sit");
        const sleep = model.animations.find((a) => a.name === "Sleep");
        const interact = model.animations.find((a) => a.name === "Interact");
        const ratio = key === "angel" ? 0.35 : 0.65;
        const start = {
          x: walkBounds.left + (walkBounds.right - walkBounds.left) * ratio,
          y:
            walkBounds.top +
            (walkBounds.bottom - walkBounds.top) * (key === "angel" ? 0.42 : 0.58),
        };
        const seed =
          (Date.now() ^ (key === "angel" ? 0x9e3779b9 : 0x85ebca6b)) >>> 0;
        const controller = new PetController({
          renderer,
          shared,
          gear: gears[key],
          profile: {
            hasSit: Boolean(sit),
            hasSleep: Boolean(sleep),
            sitSeconds: sit ? Math.max(1, sit.duration) : 3,
            pokeSeconds: interact ? interact.duration : 1.5,
          },
          start,
          bounds: walkBounds,
          boundsProvider: () => boundsFromContent(key),
          options,
          sprintSpeed,
          seed,
          rng: mulberry32(seed ^ 0x6d2b79f5),
        });
        controller.setOutline(outline);
        controller.setIceGlide(iceGlide);
        controllersRef.current[key] = controller;
        if (!desiredVisible[key]) {
          visibleRef.current[key] = false;
          controller.hide(true);
          wrappers[key].style.display = "none";
        } else {
          visibleRef.current[key] = true;
          wrappers[key].style.display = "";
          controller.show();
        }
        wrappers[key].style.transform = `translate3d(${Math.round(
          controller.pos.x,
        )}px, ${Math.round(controller.pos.y)}px, 0)`;
      }

      const raiseOverlay = () => {
        void invoke("raise_overlay").catch(() => {});
      };

      const setControlledKey = (next: CharKey | null) => {
        const prev = controlledRef.current;
        if (prev === next) {
          if (next) void getCurrentWindow().setFocus().catch(() => {});
          return;
        }
        if (prev) controllersRef.current[prev]?.endManual();
        controlledRef.current = next;
        keysRef.current.clear();
        setControlled(next);
        if (next) {
          controllersRef.current[next]?.beginManual();
          void getCurrentWindow().setFocus().catch(() => {});
        }
        boxesDirtyRef.current = true;
      };

      const applyVisibility = (key: CharKey, next: boolean) => {
        desiredVisible[key] = next;
        if (visibleRef.current[key] === next) return;
        visibleRef.current = { ...visibleRef.current, [key]: next };
        if (!next && dragKey === key) {
          const controller = controllersRef.current[key];
          controller?.endDrag(performance.now());
          setDragLock(false);
          clearTimeout(dragLockTimer);
          if (dragPointerId !== null) {
            stage.releasePointerCapture?.(dragPointerId);
          }
          dragKey = null;
          dragPointerId = null;
        }
        const controller = controllersRef.current[key];
        if (next) {
          // 先恢复 display 再启动入场；退场期间保持 display，等控制器完全隐去后再 none。
          wrappers[key].style.display = "";
          controller?.show();
          raiseOverlay();
        } else {
          controller?.hide();
        }
        if (!next && controlledRef.current === key) {
          controlledRef.current = null;
          setControlled(null);
          keysRef.current.clear();
        }
        if (!next && menuRef.current?.key === key) setMenuSafe(null);
        boxesDirtyRef.current = true;
        pushBoxes(true);
      };

      actionsRef.current.interact = (key) => {
        if (controlledRef.current === key) setControlledKey(null);
        else setControlledKey(key);
        setMenuSafe(null);
      };
      actionsRef.current.openConsole = () => {
        void (async () => {
          const [theme, material] = await Promise.all([
            getConsoleTheme(),
            getConsoleMaterial(),
          ]);
          await ensureConsole(theme, material, { focus: true });
          setMenuSafe(null);
        })();
      };
      actionsRef.current.hide = (key) => {
        if (controlledRef.current === key) setControlledKey(null);
        applyVisibility(key, false);
        void setCharacterVisible(key, false);
        setMenuSafe(null);
      };

      await unsubscribe(() =>
        subscribeGear("angel", (gear) =>
          controllersRef.current.angel?.setGear(gear),
        ),
      );
      await unsubscribe(() =>
        subscribeGear("angel2", (gear) =>
          controllersRef.current.angel2?.setGear(gear),
        ),
      );
      await unsubscribe(() =>
        subscribeInteractionOutline((enabled) => {
          controllersRef.current.angel?.setOutline(enabled);
          controllersRef.current.angel2?.setOutline(enabled);
        }),
      );
      await unsubscribe(() =>
        subscribeInteractionIceGlide((enabled) => {
          controllersRef.current.angel?.setIceGlide(enabled);
          controllersRef.current.angel2?.setIceGlide(enabled);
        }),
      );
      await unsubscribe(() =>
        subscribeFrameRate((next) => {
          frameMinMsRef.current = frameMinMs(next);
        }),
      );
      await unsubscribe(() =>
        subscribeMode((next) => {
          shared.mode = next;
          shared.virtualEpoch += 1;
          raiseOverlay();
          window.setTimeout(raiseOverlay, 60);
        }),
      );
      await unsubscribe(() =>
        subscribeLocation((next) => {
          shared.location = next;
          shared.virtualEpoch += 1;
        }),
      );
      await unsubscribe(() =>
        subscribeVirtualTime((next) => {
          shared.virtualTime = next;
          shared.virtualEpoch += 1;
        }),
      );

      // 原生窗口裁剪用的“可见框”，不是命中判定：
      // 入场/退场期间角色不可交互，但仍在画，必须留在区域里，否则会被裁掉。
      const collectBoxes = (): number[][] => {
        const boxes: number[][] = [];
        for (const key of keys) {
          const controller = controllersRef.current[key];
          if (!controller || !controller.isVisible) continue;
          const content = controller.contentBox();
          if (!content) continue;
          const pad = regionPad(speeds[key]);
          const left = Math.floor(controller.pos.x + content.left - pad);
          const top = Math.floor(controller.pos.y + content.top - pad);
          const right = Math.ceil(controller.pos.x + content.right + pad);
          const bottom = Math.ceil(controller.pos.y + content.bottom + pad);
          boxes.push([left, top, right - left, bottom - top]);
        }
        if (menuRef.current) {
          const current = menuRef.current;
          boxes.push([current.x, current.y, MENU_W, MENU_H]);
        }
        // F 提示是 DOM 层，不在角色包围盒里；不并进来会被窗口区域裁掉。
        const prompt = promptRef.current;
        if (prompt && prompt.style.opacity === "1") {
          const rect = prompt.getBoundingClientRect();
          boxes.push([
            Math.floor(rect.left),
            Math.floor(rect.top),
            Math.ceil(rect.width),
            Math.ceil(rect.height),
          ]);
        }
        if (dragLockFallback && dragKey) {
          boxes.push([0, 0, stage.clientWidth, stage.clientHeight]);
        }
        return boxes;
      };

      const pushBoxes = (force = false) => {
        const now = performance.now();
        if (!force && !boxesDirtyRef.current && now - lastBoxAt < 33) return;
        lastBoxAt = now;
        boxesDirtyRef.current = false;
        void invoke("set_hit_boxes", { boxes: collectBoxes() }).catch(() => {});
      };

      // 订阅已全部建立，接管实时应用；把模型加载期间记录的最新可见性补上。
      applyLive = applyVisibility;
      for (const key of keys) {
        if (visibleRef.current[key] !== desiredVisible[key]) {
          applyVisibility(key, desiredVisible[key]);
        }
      }

      const setDragLock = (locked: boolean) => {
        void invoke("set_drag_lock", { locked })
          .then(() => {
            if (!locked) dragLockFallback = false;
          })
          .catch(() => {
            dragLockFallback = locked;
            boxesDirtyRef.current = true;
          });
        if (locked) {
          clearTimeout(dragLockTimer);
          dragLockTimer = window.setTimeout(() => {
            setDragLock(false);
            boxesDirtyRef.current = true;
          }, 15_000);
        } else {
          clearTimeout(dragLockTimer);
        }
      };

      const point = (event: PointerEvent) => {
        const rect = stage.getBoundingClientRect();
        return {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };
      };

      const hit = (x: number, y: number): PetController | null => {
        for (const key of [...keys].reverse()) {
          const controller = controllersRef.current[key];
          if (!controller || !controller.isInteractive) continue;
          const content = controller.contentBox();
          if (!content) continue;
          if (
            x >= controller.pos.x + content.left &&
            x <= controller.pos.x + content.right &&
            y >= controller.pos.y + content.top &&
            y <= controller.pos.y + content.bottom
          ) {
            return controller;
          }
        }
        return null;
      };

      const keyFor = (controller: PetController): CharKey =>
        controller === controllersRef.current.angel ? "angel" : "angel2";

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement | null;
        if (target?.closest(".overlay-menu")) {
          return;
        }
        if (menuRef.current) {
          setMenuSafe(null);
          return;
        }
        const p = point(event);
        const controller = hit(p.x, p.y);
        if (!controller) return;
        if (!controller.beginDrag(p.x, p.y, performance.now())) return;
        dragKey = keyFor(controller);
        dragPointerId = event.pointerId;
        stage.setPointerCapture?.(event.pointerId);
        setDragLock(true);
        boxesDirtyRef.current = true;
        pushBoxes(true);
        event.preventDefault();
      };

      const onPointerMove = (event: PointerEvent) => {
        if (!dragKey) return;
        const controller = controllersRef.current[dragKey];
        if (!controller) return;
        const p = point(event);
        controller.dragTo(p.x, p.y);
        wrappers[dragKey].style.transform = `translate3d(${Math.round(
          controller.pos.x,
        )}px, ${Math.round(controller.pos.y)}px, 0)`;
      };

      const finishDrag = (event: PointerEvent) => {
        if (!dragKey) return;
        const controller = controllersRef.current[dragKey];
        controller?.endDrag(performance.now());
        if (dragPointerId !== null) {
          stage.releasePointerCapture?.(dragPointerId);
        }
        dragKey = null;
        dragPointerId = null;
        setDragLock(false);
        boxesDirtyRef.current = true;
        pushBoxes(true);
        event.preventDefault();
      };

      const onContextMenu = (event: MouseEvent) => {
        event.preventDefault();
        const p = point(event as unknown as PointerEvent);
        const controller = hit(p.x, p.y);
        if (!controller) return;
        const key = keyFor(controller);
        const x = clamp(p.x, 4, stage.clientWidth - MENU_W - 4);
        const y = clamp(p.y, 4, stage.clientHeight - MENU_H - 4);
        setMenuSafe({ key, x, y });
        pushBoxes(true);
      };

      const tryPoke = () => {
        const target = promptTargetRef.current;
        if (!target) return;
        const now = performance.now();
        if (now - lastPokeAt < 800) return;
        lastPokeAt = now;
        controllersRef.current[target.key]?.poke();
      };

      const onKey = (event: KeyboardEvent) => {
        if (event.key === "Escape") {
          if (menuRef.current) {
            setMenuSafe(null);
            pushBoxes(true);
            return;
          }
          if (controlledRef.current) {
            setControlledKey(null);
          }
          // Esc 只退菜单/互动，不退出应用，避免连按误关整个覆盖层
          return;
        }
        if (!controlledRef.current) return;
        const key = event.key.toLowerCase();
        if (key === "shift") {
          keysRef.current.add("shift");
          return;
        }
        if (key === "w" || key === "a" || key === "s" || key === "d") {
          event.preventDefault();
          // 进入互动前就按住 Shift 时，靠方向键的修饰位补记加速状态。
          if (event.shiftKey) keysRef.current.add("shift");
          else keysRef.current.delete("shift");
          keysRef.current.add(key);
        } else if (key === "f") {
          event.preventDefault();
          if (!event.repeat) tryPoke();
        }
      };

      const onKeyUp = (event: KeyboardEvent) => {
        keysRef.current.delete(event.key.toLowerCase());
      };

      const onBlur = () => {
        keysRef.current.clear();
        if (menuRef.current) {
          setMenuSafe(null);
          pushBoxes(true);
        }
      };

      const updateBounds = () => {
        const w = stage.clientWidth || window.innerWidth;
        const h = stage.clientHeight || window.innerHeight;
        walkBounds = contentWindowBounds(
          { left: 0, top: 0, right: w, bottom: h },
          { left: 0, top: 0, right: CANVAS_W, bottom: CANVAS_H },
          MARGIN_X,
          MARGIN_Y,
        );
        for (const key of keys) {
          const controller = controllersRef.current[key];
          if (!controller) continue;
          // 先按新窗口尺寸兜底，再换成当前渲染内容算出的范围。
          controller.setBounds(walkBounds);
          controller.refreshBoundsFromContent();
        }
        boxesDirtyRef.current = true;
      };

      stage.addEventListener("pointerdown", onPointerDown);
      stage.addEventListener("pointermove", onPointerMove);
      stage.addEventListener("pointerup", finishDrag);
      stage.addEventListener("pointercancel", finishDrag);
      stage.addEventListener("contextmenu", onContextMenu);
      window.addEventListener("keydown", onKey);
      window.addEventListener("keyup", onKeyUp);
      window.addEventListener("blur", onBlur);
      window.addEventListener("resize", updateBounds);
      cleanup.push(() => {
        stage.removeEventListener("pointerdown", onPointerDown);
        stage.removeEventListener("pointermove", onPointerMove);
        stage.removeEventListener("pointerup", finishDrag);
        stage.removeEventListener("pointercancel", finishDrag);
        stage.removeEventListener("contextmenu", onContextMenu);
        window.removeEventListener("keydown", onKey);
        window.removeEventListener("keyup", onKeyUp);
        window.removeEventListener("blur", onBlur);
        window.removeEventListener("resize", updateBounds);
      });

      const updateFPrompt = () => {
        const prompt = promptRef.current;
        const controlledKey = controlledRef.current;
        if (!prompt) return;
        if (!controlledKey) {
          promptTargetRef.current = null;
          prompt.style.opacity = "0";
          return;
        }
        const otherKey: CharKey =
          controlledKey === "angel" ? "angel2" : "angel";
        const mine = controllersRef.current[controlledKey];
        const other = controllersRef.current[otherKey];
        if (
          !mine ||
          !other ||
          !mine.isInteractive ||
          !other.isInteractive
        ) {
          promptTargetRef.current = null;
          prompt.style.opacity = "0";
          return;
        }
        const a = mine.contentBox();
        const b = other.contentBox();
        if (!a || !b) {
          promptTargetRef.current = null;
          prompt.style.opacity = "0";
          return;
        }
        const aLeft = mine.pos.x + a.left;
        const aRight = mine.pos.x + a.right;
        const aTop = mine.pos.y + a.top;
        const aBottom = mine.pos.y + a.bottom;
        const bLeft = other.pos.x + b.left;
        const bRight = other.pos.x + b.right;
        const bTop = other.pos.y + b.top;
        const bBottom = other.pos.y + b.bottom;
        const gapX = Math.max(
          0,
          Math.max(aLeft, bLeft) - Math.min(aRight, bRight),
        );
        const gapY = Math.max(
          0,
          Math.max(aTop, bTop) - Math.min(aBottom, bBottom),
        );
        const near = Math.hypot(gapX, gapY) <= NEAR_PX;
        if (!near) {
          promptTargetRef.current = null;
          prompt.style.opacity = "0";
          return;
        }
        const x = clamp(
          (bLeft + bRight) / 2 - 14,
          4,
          stage.clientWidth - 32,
        );
        const y = clamp(bTop - 38, 4, stage.clientHeight - 32);
        prompt.style.left = `${x}px`;
        prompt.style.top = `${y}px`;
        prompt.style.opacity = "1";
        promptTargetRef.current = { key: otherKey, x, y };
      };

      // 启动对账：overlay 先读取可见性、后订阅事件；若总控台正好在这段窗口期
      // 切换了显示，事件会丢失，而本窗口的 store 缓存仍是旧值。订阅完成后从
      // 磁盘重读一次，补回“设置已开但桌宠不出现、要再点一次按钮”的竞态。
      try {
        await reloadSettingsFromDisk();
        if (disposed) return;
        for (const key of keys) {
          const latest = await getCharacterVisible(key);
          if (disposed) return;
          if (visibleRef.current[key] !== latest) {
            applyVisibility(key, latest);
          }
        }
      } catch (err) {
        console.warn("[overlay] visibility reconcile failed", err);
      }

      setReady(true);
      raiseOverlay();
      const initialBoxes = collectBoxes();
      await invoke("set_hit_boxes", { boxes: initialBoxes }).catch(() => {});

      let last = performance.now();
      let lastRender = last;
      const tick = (now: number) => {
        try {
          if (disposed) return;
          // 按设置夹帧率：跳过的这一帧不推进物理（last 不动），dt 自然累积到下一帧。
          const minMs = frameMinMsRef.current;
          if (minMs > 0 && now - lastRender < minMs) {
            raf = requestAnimationFrame(tick);
            return;
          }
          lastRender = now;
          const rawDt = (now - last) / 1000;
          // 首帧 rAF 时间戳可能早于建循环时取的 performance.now()，dt 会为负；
          // 夹到 0 避免物理拿到负步长。
          const dt = Math.min(0.05, Math.max(0, rawDt));
          last = now;
          const controlledKey = controlledRef.current;
          for (const key of keys) {
            const controller = controllersRef.current[key];
            if (!controller) continue;
            if (key === controlledKey && !controller.isDragging) {
              const dx =
                (keysRef.current.has("d") ? 1 : 0) -
                (keysRef.current.has("a") ? 1 : 0);
              const dy =
                (keysRef.current.has("s") ? 1 : 0) -
                (keysRef.current.has("w") ? 1 : 0);
              // 过渡中 isInteractive=false，这里会自动变成空操作。
              controller.manualMove(dx, dy, dt, keysRef.current.has("shift"));
            }
            controller.step(now, dt);
            // 实际位移速度（px/s），给窗口区域 padding 用；平滑一下避免抖动。
            const p = controller.pos;
            if (!posReady[key]) {
              posReady[key] = true;
              lastPos[key] = { x: p.x, y: p.y };
            }
            const inst =
              Math.hypot(p.x - lastPos[key].x, p.y - lastPos[key].y) /
              Math.max(1e-3, dt);
            speeds[key] = speeds[key] * 0.6 + inst * 0.4;
            lastPos[key] = { x: p.x, y: p.y };
            if (!controller.isVisible) {
              // 退场结束（reveal 到 0）后才真正撤掉 wrapper。
              wrappers[key].style.display = "none";
              continue;
            }
            if (wrappers[key].style.display === "none") {
              wrappers[key].style.display = "";
            }
            wrappers[key].style.transform = `translate3d(${Math.round(
              controller.pos.x,
            )}px, ${Math.round(controller.pos.y)}px, 0)`;
            controller.draw();
          }
          updateFPrompt();
          pushBoxes();
          raf = requestAnimationFrame(tick);
        } catch (err) {
          console.error("[overlay] tick", err);
          throw err;
        }
      };
      raf = requestAnimationFrame(tick);
    })().catch((err) => {
      console.error("[overlay]", err);
      if (!disposed) setError(String(err));
    });

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      clearTimeout(dragLockTimer);
      void invoke("set_drag_lock", { locked: false }).catch(() => {});
      for (const fn of cleanup) fn();
    };
  }, []);

  return (
    <div className="overlay-stage" ref={stageRef}>
      <div
        className={`overlay-pet${controlled === "angel2" ? " is-controlled" : ""}`}
        ref={angel2WrapRef}
      >
        <canvas ref={angel2CanvasRef} width={CANVAS_W} height={CANVAS_H} />
      </div>
      <div
        className={`overlay-pet${controlled === "angel" ? " is-controlled" : ""}`}
        ref={angelWrapRef}
      >
        <canvas ref={angelCanvasRef} width={CANVAS_W} height={CANVAS_H} />
      </div>
      <div className="overlay-f-prompt" ref={promptRef}>
        F
      </div>
      {ready && menu ? (
        <div
          className="overlay-menu"
          style={{ left: menu.x, top: menu.y }}
          role="menu"
          aria-label={t("overlay.menuAria")}
          onPointerDown={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => actionsRef.current.openConsole()}
          >
            {t("overlay.openConsole")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => actionsRef.current.interact(menu.key)}
          >
            {controlled === menu.key
              ? t("overlay.exitInteract")
              : t("overlay.interact")}
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => actionsRef.current.hide(menu.key)}
          >
            {t("overlay.hide")}
          </button>
        </div>
      ) : null}
      {error ? <pre className="overlay-error">{error}</pre> : null}
    </div>
  );
}
