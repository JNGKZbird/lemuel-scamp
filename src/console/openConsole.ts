import { primaryMonitor } from "@tauri-apps/api/window";
import { WebviewWindow, getAllWebviewWindows } from "@tauri-apps/api/webviewWindow";
import type { ConsoleMaterial, ConsoleTheme } from "../settings/store";
import { getLanguage, translate } from "../i18n";

const FALLBACK_WIDTH = 1066;
const FALLBACK_HEIGHT = 729;
const MIN_WIDTH = 640;
const MIN_HEIGHT = 400;
let opening: Promise<void> | null = null;

async function focusExisting(win: WebviewWindow): Promise<void> {
  await win.unminimize().catch(() => {});
  await win.show().catch(() => {});
  await win.setFocus().catch(() => {});
}

type ConsoleOptions = {
  focus: boolean;
  /** 首启素材安装：总控台直接以 onboarding 模式打开。 */
  onboarding?: boolean;
  /** asset_status 失败时的详情，让安装器直接落在错误态。 */
  installerError?: string | null;
};

async function createConsole(
  theme: ConsoleTheme,
  material: ConsoleMaterial,
  opts: ConsoleOptions,
): Promise<void> {
  const monitor = await primaryMonitor().catch(() => null);
  const scale = monitor?.scaleFactor ?? 1;
  const work = monitor?.workArea;
  const width = work
    ? Math.round((work.size.width / scale) * 0.74)
    : FALLBACK_WIDTH;
  const height = work
    ? Math.round((work.size.height / scale) * 0.81)
    : FALLBACK_HEIGHT;

  const background =
    material === "classic"
      ? theme === "black"
        ? "#0b0d10"
        : "#ffffff"
      : theme === "black"
        ? "#000000"
        : "#e7e3db";

  const params = new URLSearchParams({
    view: "console",
    theme,
    material,
  });
  if (opts.onboarding) params.set("onboarding", "1");
  if (opts.installerError) params.set("installerError", opts.installerError);

  const consoleWindow = new WebviewWindow("console", {
    url: `/?${params.toString()}`,
    title: translate(getLanguage(), "app.consoleWindowTitle"),
    width,
    height,
    center: true,
    decorations: false,
    transparent: true,
    resizable: true,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    maximizable: false,
    minimizable: true,
    closable: true,
    skipTaskbar: false,
    alwaysOnTop: false,
    shadow: true,
    focus: opts.focus,
    backgroundColor: background,
  });

  await new Promise<void>((resolve, reject) => {
    consoleWindow.once("tauri://created", () => resolve());
    consoleWindow.once("tauri://error", (event) => reject(event));
  });
  await consoleWindow.show().catch(() => {});
  await consoleWindow.unminimize().catch(() => {});
}

export async function ensureConsole(
  theme: ConsoleTheme,
  material: ConsoleMaterial,
  opts: ConsoleOptions,
): Promise<void> {
  const existing = (await getAllWebviewWindows()).find((w) => w.label === "console");
  if (existing) {
    if (opts.focus) await focusExisting(existing);
    return;
  }

  if (!opening) {
    opening = createConsole(theme, material, opts)
      .catch(async (err) => {
        // 双窗并发创建时 label 已存在会报错：重新查询并聚焦。
        const again = (await getAllWebviewWindows()).find((w) => w.label === "console");
        if (again) {
          if (opts.focus) await focusExisting(again);
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
