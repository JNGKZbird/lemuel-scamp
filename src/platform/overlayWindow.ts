import { invoke } from "@tauri-apps/api/core";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getLogicalWorkArea } from "./workArea.ts";
import { getLanguage, translate } from "../i18n";

let opening: Promise<void> | null = null;

async function createOverlayWindow(): Promise<void> {
  const work = await getLogicalWorkArea();
  const width = work ? Math.max(1, Math.round(work.right - work.left)) : window.screen.availWidth;
  const height = work ? Math.max(1, Math.round(work.bottom - work.top)) : window.screen.availHeight;
  const x = work ? Math.round(work.left) : 0;
  const y = work ? Math.round(work.top) : 0;

  const overlay = new WebviewWindow("overlay", {
    url: "/?view=overlay&poc=1",
    title: translate(getLanguage(), "app.overlayWindowTitle"),
    x,
    y,
    width,
    height,
    decorations: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    shadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    closable: true,
    focus: false,
    // 先隐藏创建，等打上 WS_EX_TOOLWINDOW 再显示，避免第一帧被 Chromium
    // 的遮挡判定当成整屏不透明遮挡物（见 prepare_overlay_window）。
    visible: false,
  });

  await new Promise<void>((resolve, reject) => {
    overlay.once("tauri://created", () => resolve());
    overlay.once("tauri://error", (event) => reject(event));
  });

  // 失败就退回普通 show：宁可遮挡一次，也不能让桌宠窗口一直不可见。
  await invoke("prepare_overlay_window").catch(async (err) => {
    console.error("[overlay] prepare_overlay_window", err);
    await overlay.show().catch(() => {});
  });
}

export async function ensureOverlayWindow(): Promise<void> {
  const existing = (await getAllWebviewWindows()).find((w) => w.label === "overlay");
  if (existing) {
    await existing.show().catch(() => {});
    return;
  }

  if (!opening) {
    opening = createOverlayWindow()
      .catch(async (err) => {
        const again = (await getAllWebviewWindows()).find((w) => w.label === "overlay");
        if (again) {
          await again.show().catch(() => {});
          return;
        }
        throw err;
      })
      .finally(() => {
        opening = null;
      });
  }
  await opening;
}
