import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import { getLogicalWorkArea } from "./workArea.ts";

let opening: Promise<void> | null = null;

async function createOverlayWindow(): Promise<void> {
  const work = await getLogicalWorkArea();
  const width = work ? Math.max(1, Math.round(work.right - work.left)) : window.screen.availWidth;
  const height = work ? Math.max(1, Math.round(work.bottom - work.top)) : window.screen.availHeight;
  const x = work ? Math.round(work.left) : 0;
  const y = work ? Math.round(work.top) : 0;

  const overlay = new WebviewWindow("overlay", {
    url: "/?view=overlay&poc=1",
    title: "Lemuel Scamp · 覆盖层",
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
  });

  await new Promise<void>((resolve, reject) => {
    overlay.once("tauri://created", () => resolve());
    overlay.once("tauri://error", (event) => reject(event));
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
