import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";

export type CharKey = "angel" | "angel2";

// 基建角色 prefab：Graphic.localScale = 0.18，SkeletonDataAsset.scale = 0.01。
export const MODEL_WORLD_SCALE = 0.0018;

// 基建操控模式的移动速度（世界单位/秒）。
// VCharacterController..ctor：_moveSpeed = 3.0，_moveMaxSpeed = 4.5；
// StartControlVChar：m_moveSpeed = min(角色 options.moveSpeed × 3.0, 4.5)。
// 能天使：min(1.2 × 3.0, 4.5) = 3.6；新约能天使：min(1.0 × 3.0, 4.5) = 3.0。
export const CHARS: Record<
  CharKey,
  {
    folder: string;
    name: string;
    stance: number;
    controlSpeed: number;
    title: string;
  }
> = {
  angel: {
    folder: "angel",
    name: "build_char_103_angel_white",
    stance: 185.8,
    controlSpeed: 3.6,
    title: "Lemuel Scamp · 能天使",
  },
  angel2: {
    folder: "angel2",
    name: "build_char_1041_angel2",
    stance: 204.0,
    controlSpeed: 3.0,
    title: "Lemuel Scamp · 新约能天使",
  },
};

export const TURN_SECONDS = 0.15;

// null = 开发态，沿用同源的 /models；字符串 = 已安装素材的 asset 协议基址。
let assetBase: string | null = null;

export function initAssetBase(base: string | null): void {
  assetBase = base;
}

export function modelDir(key: CharKey): string {
  return `${assetBase ?? "/models"}/${CHARS[key].folder}`;
}

/**
 * 启动时询问 Rust：素材来源是 public/models（dev）还是安装目录（installed）。
 * 已安装时把 asset 协议基址设好；其余情况保持 /models。
 */
export async function initAssetBaseFromStatus(): Promise<void> {
  if (!isTauri()) {
    initAssetBase(null);
    return;
  }
  try {
    const status = await invoke<{
      source: string;
      modelsDir: string | null;
    }>("asset_status");
    const modelsDir = status.source === "installed" ? status.modelsDir : null;
    initAssetBase(modelsDir ? convertFileSrc(modelsDir) : null);
  } catch (err) {
    console.error("[assets] asset_status", err);
    initAssetBase(null);
  }
}
