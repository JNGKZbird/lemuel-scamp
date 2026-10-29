import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ensureOverlayWindow } from "../platform/overlayWindow.ts";
import { ensureConsole } from "../console/openConsole";
import {
  getConsoleMaterial,
  getConsoleTheme,
  initSettings,
} from "../settings/store";

export default function OverlayBootstrap() {
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        await initSettings();
        await ensureOverlayWindow();
        const [theme, material] = await Promise.all([
          getConsoleTheme(),
          getConsoleMaterial(),
        ]);
        await ensureConsole(theme, material, { focus: false });
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
