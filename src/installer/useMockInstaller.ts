import { useCallback, useEffect, useRef, useState } from "react";
import { ASSET_PACK } from "./meta";
import type {
  InstallerController,
  InstallerPhase,
  InstallerState,
} from "./types";

// 模拟时间线：下载约 4 秒，校验 0.6 秒，安装 0.7 秒。不发起任何网络请求，不写磁盘。
const DOWNLOAD_MS = 4000;
const TICK_MS = 80;
const VERIFY_MS = 600;
const INSTALL_MS = 700;

const SAMPLE_ERROR = {
  code: "network",
  detail:
    "GET https://github.com/JNGKZbird/Arknights-Desktop-Pets-Archive/releases/download/trickster-assets-v1/windows.zip\n" +
    "error sending request: connection reset by peer (os error 10054)",
} as const;

export function useMockInstaller(): InstallerController {
  const [state, setState] = useState<InstallerState>({ phase: "welcome" });
  const timerRef = useRef<number | null>(null);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const later = useCallback((ms: number, run: () => void) => {
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      run();
    }, ms);
  }, []);

  useEffect(() => clearTimer, [clearTimer]);

  const start = useCallback(() => {
    clearTimer();
    const total = ASSET_PACK.downloadBytes;
    setState({ phase: "downloading", received: 0, total });
    const steps = Math.ceil(DOWNLOAD_MS / TICK_MS);
    let step = 0;
    const tick = () => {
      step += 1;
      const progress = Math.min(1, step / steps);
      // 缓出：前段快、末段慢，像真实下载的尾巴。
      const eased = 1 - (1 - progress) ** 2;
      if (progress >= 1) {
        setState({ phase: "verifying" });
        later(VERIFY_MS, () => {
          setState({ phase: "installing" });
          later(INSTALL_MS, () => setState({ phase: "done" }));
        });
        return;
      }
      setState({
        phase: "downloading",
        received: Math.round(total * eased),
        total,
      });
      later(TICK_MS, tick);
    };
    later(TICK_MS, tick);
  }, [clearTimer, later]);

  const cancel = useCallback(() => {
    clearTimer();
    setState({ phase: "welcome" });
  }, [clearTimer]);

  const retry = useCallback(() => start(), [start]);

  // 预览里“手动导入”同样只走模拟；Phase B 换成文件选择器。
  const importZip = useCallback(() => start(), [start]);

  const finish = useCallback(() => {
    clearTimer();
  }, [clearTimer]);

  const jump = useCallback(
    (phase: InstallerPhase) => {
      clearTimer();
      switch (phase) {
        case "welcome":
          setState({ phase: "welcome" });
          break;
        case "downloading":
          setState({
            phase: "downloading",
            received: Math.round(ASSET_PACK.downloadBytes * 0.46),
            total: ASSET_PACK.downloadBytes,
          });
          break;
        case "verifying":
          setState({ phase: "verifying" });
          break;
        case "installing":
          setState({ phase: "installing" });
          break;
        case "done":
          setState({ phase: "done" });
          break;
        case "error":
          setState({ phase: "error", ...SAMPLE_ERROR });
          break;
      }
    },
    [clearTimer],
  );

  return { state, start, cancel, retry, importZip, finish, jump };
}
