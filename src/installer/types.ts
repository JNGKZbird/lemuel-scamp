// 首次启动素材安装的状态与控制器接口。
// Phase A 只有 useMockInstaller；Phase B 的 useLiveInstaller 实现同一个接口，UI 不改。

export type InstallerPhase =
  | "welcome"
  | "downloading"
  | "verifying"
  | "installing"
  | "done"
  | "error";

export type InstallerErrorCode =
  | "network"
  | "hash_mismatch"
  | "unsafe_archive"
  | "disk"
  | "cancelled"
  | "unknown";

export type InstallerMode = "preview" | "live";

export type InstallerState =
  | { phase: "welcome" }
  | { phase: "downloading"; received: number; total: number }
  | { phase: "verifying" }
  | { phase: "installing" }
  | { phase: "done" }
  | { phase: "error"; code: InstallerErrorCode; detail: string };

export type InstallerController = {
  state: InstallerState;
  start: () => void;
  cancel: () => void;
  retry: () => void;
  importZip: () => void;
  finish: () => void;
  /** 仅开发预览：直接跳到某个状态；live 控制器不实现。 */
  jump?: (phase: InstallerPhase) => void;
};
