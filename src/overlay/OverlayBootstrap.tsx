import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ensureOverlayWindow } from "../platform/overlayWindow.ts";
import { ensureConsole } from "../console/openConsole";
import {
  getConsoleMaterial,
  getConsoleTheme,
  initSettings,
} from "../settings/store";

type AssetStatus = { source: "installed" | "dev" | "missing" };

export default function OverlayBootstrap() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await initSettings();
        // 素材缺失时先只开总控台跑安装器，安装器自己会在完成时调用
        // ensureOverlayWindow；首启不会有已加载的模型占着文件。
        let status: AssetStatus | null = null;
        let statusError: string | null = null;
        try {
          status = await invoke<AssetStatus>("asset_status");
        } catch (err) {
          statusError = String(err);
        }
        const [theme, material] = await Promise.all([
          getConsoleTheme(),
          getConsoleMaterial(),
        ]);
        if (!status || status.source === "missing") {
          await ensureConsole(theme, material, {
            focus: true,
            onboarding: true,
            installerError: statusError,
          });
        } else {
          await ensureOverlayWindow();
          await ensureConsole(theme, material, { focus: false });
        }
        if (alive) await getCurrentWindow().close();
      } catch (err) {
        if (alive) setError(String(err));
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <pre style={{ color: "#b3541e", fontSize: 10, whiteSpace: "pre-wrap" }}>
        {error}
      </pre>
    );
  }
  return null;
}
