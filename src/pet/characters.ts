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
    dir: string;
    name: string;
    stance: number;
    controlSpeed: number;
    title: string;
  }
> = {
  angel: {
    dir: "/models/angel",
    name: "build_char_103_angel_white",
    stance: 185.8,
    controlSpeed: 3.6,
    title: "Lemuel Scamp · 能天使",
  },
  angel2: {
    dir: "/models/angel2",
    name: "build_char_1041_angel2",
    stance: 204.0,
    controlSpeed: 3.0,
    title: "Lemuel Scamp · 新约能天使",
  },
};

export const TURN_SECONDS = 0.15;
