import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import { GlassRenderer } from "./GlassRenderer";
import type { ThemeId, ThicknessLevel } from "./config";

type StageState = {
  theme: ThemeId;
  thickness: ThicknessLevel;
  enabled: boolean;
};

export function useGlassStage(
  shellRef: RefObject<HTMLElement | null>,
  canvasRef: RefObject<HTMLCanvasElement | null>,
  state: StageState,
) {
  const rendererRef = useRef<GlassRenderer | null>(null);
  const [rendererState, setRendererState] = useState<"pending" | "webgl" | "fallback">("pending");

  useEffect(() => {
    if (!state.enabled) {
      setRendererState("fallback");
      return;
    }
    const shell = shellRef.current;
    const canvas = canvasRef.current;
    if (!shell || !canvas) return;

    let renderer: GlassRenderer;
    try {
      renderer = new GlassRenderer(canvas, {
        onFallback: () => setRendererState("fallback"),
      });
    } catch (err) {
      console.error("[glass] init", err);
      setRendererState("fallback");
      return;
    }
    rendererRef.current = renderer;
    setRendererState("webgl");
    renderer.initialize(state.theme, state.thickness, [1, 1], 0);

    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    renderer.setReducedMotion(media.matches);
    const onMotionChange = (event: MediaQueryListEvent) => renderer.setReducedMotion(event.matches);
    media.addEventListener("change", onMotionChange);

    // 全屏/还原会连续触发多次尺寸变化：过渡期间让 CSS 拉伸上一帧，
    // 尺寸稳定后才重建画布/FBO，避免每帧清空缓冲造成闪烁和卡顿。
    let resizeTimer = 0;
    let lastW = 0;
    let lastH = 0;
    const applyResize = () => {
      const w = shell.clientWidth;
      const h = shell.clientHeight;
      if (w === lastW && h === lastH) return;
      lastW = w;
      lastH = h;
      renderer.resize(w, h);
    };
    const onResize = () => {
      if (resizeTimer) window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        resizeTimer = 0;
        applyResize();
      }, 90);
    };
    const observer = new ResizeObserver(onResize);
    observer.observe(shell);
    applyResize();
    renderer.start();

    const onVisibility = () => {
      if (document.visibilityState === "hidden") renderer.stop();
      else if (!media.matches) renderer.start();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      observer.disconnect();
      if (resizeTimer) window.clearTimeout(resizeTimer);
      media.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibility);
      renderer.dispose();
      rendererRef.current = null;
      setRendererState("pending");
    };
  }, [shellRef, canvasRef, state.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    rendererRef.current?.setTheme(state.theme);
  }, [state.theme]);

  useEffect(() => {
    rendererRef.current?.setThickness(state.thickness);
  }, [state.thickness]);

  return { rendererState };
}
