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
  /** 安装完成后的“开始”：live 会先创建桌宠覆盖层；失败抛回完成页就地展示，不重新下载。 */
  finish: () => void | Promise<void>;
  /** live：在文件管理器中打开安装目录。 */
  reveal?: () => void;
  /** 仅开发预览：直接跳到某个状态；live 控制器不实现。 */
  jump?: (phase: InstallerPhase) => void;
};
