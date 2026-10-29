import { useCallback, useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { open } from "@tauri-apps/plugin-dialog";
import { initAssetBase } from "../pet/characters";
import { ensureOverlayWindow } from "../platform/overlayWindow";
import { ASSET_PACK } from "./meta";
import type {
  InstallerController,
  InstallerErrorCode,
  InstallerState,
} from "./types";

type ProgressPayload = {
  phase: "downloading" | "verifying" | "installing";
  received?: number;
  total?: number;
};

type InstallResult = {
  modelsDir: string;
  version: string;
  files: number;
};

type SerializedError = { code?: string; detail?: string };

const ERROR_CODES: InstallerErrorCode[] = [
  "network",
  "hash_mismatch",
  "unsafe_archive",
  "disk",
  "cancelled",
  "unknown",
];

function normalizeError(err: unknown): {
  code: InstallerErrorCode;
  detail: string;
} {
  if (typeof err === "object" && err !== null) {
    const record = err as SerializedError;
    const code = ERROR_CODES.includes(record.code as InstallerErrorCode)
      ? (record.code as InstallerErrorCode)
      : "unknown";
    return { code, detail: record.detail ?? String(err) };
  }
  return { code: "unknown", detail: String(err) };
}

type Options = {
  /** asset_status 失败时直接落在错误态。 */
  initialError?: { code: InstallerErrorCode; detail: string } | null;
};

export function useLiveInstaller(options?: Options): InstallerController {
  const [state, setState] = useState<InstallerState>(() =>
    options?.initialError
      ? { phase: "error", ...options.initialError }
      : { phase: "welcome" },
  );
  const mounted = useRef(true);
  // 每次 start/取消递增；旧下载的结果回来时靠它作废，避免覆盖新一轮的状态。
  const runRef = useRef(0);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    void listen<ProgressPayload>("installer-progress", (event) => {
      if (!mounted.current) return;
      const payload = event.payload;
      if (payload.phase === "downloading") {
        setState({
          phase: "downloading",
          received: payload.received ?? 0,
          total: payload.total ?? ASSET_PACK.downloadBytes,
        });
      } else if (payload.phase === "verifying") {
        setState({ phase: "verifying" });
      } else if (payload.phase === "installing") {
        setState({ phase: "installing" });
      }
    }).then((fn) => {
      unlisten = fn;
    }).catch((err: unknown) => {
      // 非 Tauri 环境（浏览器预览）没有事件通道，静默降级。
      console.error("[installer] listen", err);
    });
    return () => {
      unlisten?.();
    };
  }, []);

  const start = useCallback(() => {
    const run = ++runRef.current;
    setState({
      phase: "downloading",
      received: 0,
      total: ASSET_PACK.downloadBytes,
    });
    invoke<InstallResult>("installer_download")
      .then((result) => {
        if (run !== runRef.current) return;
        initAssetBase(convertFileSrc(result.modelsDir));
        if (mounted.current) setState({ phase: "done" });
      })
      .catch((err: unknown) => {
        if (run !== runRef.current || !mounted.current) return;
        const { code, detail } = normalizeError(err);
        setState(
          code === "cancelled"
            ? { phase: "welcome" }
            : { phase: "error", code, detail },
        );
      });
  }, []);

  const cancel = useCallback(() => {
    // 立刻回到欢迎页：后端的取消是尽力而为，不能让界面停在一个只有
    // “取消”按钮、点它却没反应的僵死下载态。旧 run 的结果由 runRef 作废。
    runRef.current += 1;
    if (mounted.current) setState({ phase: "welcome" });
    invoke("installer_cancel").catch((err: unknown) => {
      console.error("[installer] cancel", err);
    });
  }, []);

  const retry = useCallback(() => start(), [start]);

  const importZip = useCallback(async () => {
    try {
      const picked = await open({
        multiple: false,
        directory: false,
        filters: [{ name: "zip", extensions: ["zip"] }],
      });
      if (typeof picked !== "string") return;
      setState({ phase: "verifying" });
      const result = await invoke<InstallResult>("installer_install_zip", {
        path: picked,
      });
      initAssetBase(convertFileSrc(result.modelsDir));
      if (mounted.current) setState({ phase: "done" });
    } catch (err) {
      if (!mounted.current) return;
      const { code, detail } = normalizeError(err);
      setState({ phase: "error", code, detail });
    }
  }, []);

  // 创建覆盖层失败只抛回完成页，把状态留在 done：素材已经装好，
  // 重试不应重新下载。错误由安装器页就地展示。
  const finish = useCallback(async () => {
    await ensureOverlayWindow();
  }, []);

  const reveal = useCallback(() => {
    invoke("installer_reveal").catch((err: unknown) => {
      console.error("[installer] reveal", err);
    });
  }, []);

  return { state, start, cancel, retry, importZip, finish, reveal };
}
