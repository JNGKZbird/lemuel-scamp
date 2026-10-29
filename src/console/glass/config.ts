export type ThemeId = "white" | "black" | "red";
export type ThicknessLevel = 0 | 1 | 2 | 3 | 4;
export type Rgb = [number, number, number];

export type CharacterVisual = {
  key: "angel" | "angel2";
  name: string;
  nameEn: string;
  hair: string;
  bead: Record<ThemeId, string>;
  ink: Record<ThemeId, string>;
  pigment: Rgb;
};

export type ThemeConfig = {
  id: ThemeId;
  label: string;
  en: string;
  scene: {
    colorA: Rgb;
    colorB: Rgb;
    lightA: Rgb;
    lightB: Rgb;
    caustic: Rgb;
    flowSpeed: number;
    warp: number;
    scale: number;
    grain: number;
    calm: number;
    lightGain: number;
    causticShade: Rgb;
    causticShadeAmt: number;
    causticGain: number;
  };
  glass: {
    tint: Rgb;
    veil: Rgb;
    rim: Rgb;
    spec: Rgb;
    absorb: number;
    specAmt: number;
    specPow: number;
    rimAmt: number;
    bevelScale: number;
  };
  spring: { k: number; c: number };
};

export type ThicknessConfig = {
  level: ThicknessLevel;
  label: string;
  en: string;
  mm: number;
  edgeBand: number;
  refract: number;
  dispersion: number;
  veil: Record<ThemeId, number>;
  weight: number;
  lens: number;
  caustic: number;
  bevel: number;
  lensDisp: number;
  viscosity: number;
};

export type PreviewConfig = {
  preview: boolean;
  width: number;
  height: number;
  theme: ThemeId;
  thickness: ThicknessLevel;
};

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

export const CHARACTERS: CharacterVisual[] = [
  {
    key: "angel",
    name: "能天使",
    nameEn: "Exusiai",
    hair: "#853C54",
    bead: { white: "#853C54", black: "#C9738B", red: "#FF9E90" },
    ink: { white: "#6E2C42", black: "#E5A9B4", red: "#FFE4DD" },
    pigment: hex("#853C54"),
  },
  {
    key: "angel2",
    name: "新约能天使",
    nameEn: "Exusiai the New Covenant",
    hair: "#D84D56",
    bead: { white: "#D84D56", black: "#FF7F8C", red: "#FFD0C4" },
    ink: { white: "#9E2E39", black: "#FFAFB4", red: "#FFF0EA" },
    pigment: hex("#D84D56"),
  },
];

export const THEMES: Record<ThemeId, ThemeConfig> = {
  white: {
    id: "white",
    label: "白瓷",
    en: "PORCELAIN",
    scene: {
      colorA: hex("#F8F5EE"),
      colorB: hex("#C9C0AE"),
      lightA: hex("#FFFDF8"),
      lightB: hex("#CDC4B2"),
      caustic: hex("#FFFDF8"),
      flowSpeed: 0.08,
      warp: 1.0,
      scale: 1.0,
      grain: 0.003,
      calm: 0,
      lightGain: 0.45,
      causticShade: hex("#B0A58F"),
      causticShadeAmt: 0.55,
      causticGain: 0.12,
    },
    glass: {
      tint: hex("#EFE9DD"),
      veil: hex("#F5F0E6"),
      rim: hex("#FFFDF8"),
      spec: hex("#FFFDF8"),
      absorb: 0.24,
      specAmt: 0.45,
      specPow: 90,
      rimAmt: 0.72,
      bevelScale: 0.6,
    },
    spring: { k: 200, c: 24 },
  },
  black: {
    id: "black",
    label: "曜石",
    en: "OBSIDIAN",
    scene: {
      colorA: hex("#000000"),
      colorB: hex("#020304"),
      lightA: hex("#9FC4DE"),
      lightB: hex("#1E303C"),
      caustic: hex("#B8DFF5"),
      flowSpeed: 0.05,
      warp: 1.35,
      scale: 0.9,
      grain: 0.004,
      calm: 0,
      lightGain: 0.06,
      causticShade: hex("#0C1A24"),
      causticShadeAmt: 0.38,
      causticGain: 0.16,
    },
    glass: {
      tint: hex("#000000"),
      veil: hex("#000000"),
      rim: hex("#D7E7F5"),
      spec: hex("#FFFFFF"),
      absorb: 0.3,
      specAmt: 0.55,
      specPow: 120,
      rimAmt: 0.8,
      bevelScale: 1,
    },
    spring: { k: 95, c: 22 },
  },
  red: {
    id: "red",
    label: "陶红",
    en: "TERRACOTTA",
    scene: {
      colorA: hex("#D5927B"),
      colorB: hex("#8E4534"),
      lightA: hex("#FFE2D3"),
      lightB: hex("#6E3225"),
      caustic: hex("#FFD7C6"),
      flowSpeed: 0.09,
      warp: 1.1,
      scale: 1.0,
      grain: 0.003,
      calm: 0,
      lightGain: 0.8,
      causticShade: hex("#7A3B2C"),
      causticShadeAmt: 0.48,
      causticGain: 0.18,
    },
    glass: {
      tint: hex("#C8816B"),
      veil: hex("#D5927B"),
      rim: hex("#FFE0D2"),
      spec: hex("#FFF4EC"),
      absorb: 0.2,
      specAmt: 0.5,
      specPow: 80,
      rimAmt: 0,
      bevelScale: 0.75,
    },
    spring: { k: 260, c: 30 },
  },
};

export const THICKNESSES: ThicknessConfig[] = [
  {
    level: 0,
    label: "超薄",
    en: "ULTRA THIN",
    mm: 3,
    edgeBand: 4,
    refract: 3,
    dispersion: 0.4,
    veil: { white: 0.14, black: 0.16, red: 0.14 },
    weight: 1.35,
    lens: 0.12,
    caustic: 0.55,
    bevel: 0.05,
    lensDisp: 0.001,
    viscosity: 1,
  },
  {
    level: 1,
    label: "薄",
    en: "THIN",
    mm: 9,
    edgeBand: 6,
    refract: 6,
    dispersion: 0.8,
    veil: { white: 0.19, black: 0.22, red: 0.19 },
    weight: 1.2,
    lens: 0.17,
    caustic: 0.75,
    bevel: 0.08,
    lensDisp: 0.0015,
    viscosity: 0.94,
  },
  {
    level: 2,
    label: "常规",
    en: "REGULAR",
    mm: 18,
    edgeBand: 10,
    refract: 10,
    dispersion: 1.3,
    veil: { white: 0.24, black: 0.28, red: 0.24 },
    weight: 1,
    lens: 0.24,
    caustic: 1,
    bevel: 0.12,
    lensDisp: 0.002,
    viscosity: 0.88,
  },
  {
    level: 3,
    label: "厚",
    en: "THICK",
    mm: 30,
    edgeBand: 16,
    refract: 15,
    dispersion: 2,
    veil: { white: 0.3, black: 0.34, red: 0.3 },
    weight: 0.82,
    lens: 0.31,
    caustic: 1.25,
    bevel: 0.17,
    lensDisp: 0.0028,
    viscosity: 0.8,
  },
  {
    level: 4,
    label: "超厚",
    en: "ULTRA THICK",
    mm: 44,
    edgeBand: 22,
    refract: 21,
    dispersion: 3,
    veil: { white: 0.36, black: 0.4, red: 0.36 },
    weight: 0.62,
    lens: 0.38,
    caustic: 1.5,
    bevel: 0.22,
    lensDisp: 0.0036,
    viscosity: 0.72,
  },
];

export const THEME_IDS: ThemeId[] = ["white", "black", "red"];

export function themeById(id: string | null | undefined): ThemeConfig {
  const aliases: Record<string, ThemeId> = {
    white: "white",
    porcelain: "white",
    black: "black",
    obsidian: "black",
    red: "red",
    terracotta: "red",
    clay: "red",
    apple: "red",
    "product-red": "red",
    productred: "red",
  };
  const resolved = aliases[(id ?? "").toLowerCase()] ?? "white";
  // 陶红主题构思中：暂不对外暴露，URL 传入时回退白瓷。
  return resolved === "red" ? THEMES.white : THEMES[resolved];
}

export function thicknessByLevel(level: number): ThicknessConfig {
  const clamped = Math.min(4, Math.max(0, Math.round(level))) as ThicknessLevel;
  return THICKNESSES[clamped];
}

export function springFor(theme: ThemeConfig, thickness: ThicknessConfig) {
  return {
    k: theme.spring.k * thickness.weight,
    c: theme.spring.c * (0.82 + thickness.weight * 0.18),
  };
}

export function parsePreviewConfig(search: string): PreviewConfig {
  const params = new URLSearchParams(search);
  const rawWidth = Number(params.get("w"));
  const width = Number.isFinite(rawWidth) && rawWidth > 0
    ? Math.min(1400, Math.max(640, Math.round(rawWidth)))
    : 1066;
  const rawHeight = Number(params.get("h") ?? params.get("height"));
  const height = Number.isFinite(rawHeight) && rawHeight > 0
    ? Math.min(900, Math.max(400, Math.round(rawHeight)))
    : 729;
  const theme = themeById(params.get("theme"));
  const rawThickness = Number(params.get("thick") ?? params.get("thickness"));
  const thickness = Number.isFinite(rawThickness)
    ? thicknessByLevel(rawThickness).level
    : 2;
  return {
    preview: params.get("preview") === "1",
    width,
    height,
    theme: theme.id,
    thickness,
  };
}

export function thicknessReadout(theme: ThemeConfig, thickness: ThicknessConfig): string {
  return `${theme.label} · ${thickness.label} · ${thickness.mm} mm`;
}
