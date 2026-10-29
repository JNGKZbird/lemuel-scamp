export type Rgb = readonly [number, number, number];
export type GlobePaletteId = "ivory" | "moon" | "ice";

export type GlobePalette = {
  fillDay: Rgb;
  fillNight: Rgb;
  lineDay: Rgb;
  lineNight: Rgb;
  lineAlphaDay: number;
  lineAlphaNight: number;
  secondaryAlpha: number;
  accent: Rgb;
  accentAlpha: number;
  terminator: Rgb;
  rim: Rgb;
  rimAlpha: number;
  marker: Rgb;
  markerRing: Rgb;
};

const hex = (value: string): Rgb => {
  const n = Number.parseInt(value.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};

const SHARED = {
  fillNight: hex("#06080b"),
  lineNight: hex("#a9bccd"),
  lineAlphaNight: 0.3,
  secondaryAlpha: 0.28,
  accent: hex("#54b9ff"),
  accentAlpha: 0.3,
  terminator: hex("#e9c88d"),
  rim: hex("#cfe0f0"),
  rimAlpha: 0.08,
  marker: hex("#3b82f6"),
  markerRing: hex("#ffffff"),
} as const;

// Three warm/cool off-white directions for the lit hemisphere. The night fill
// matches the page backdrop (--globe-plate in globe.css).
export const GLOBE_PALETTES: Record<GlobePaletteId, GlobePalette> = {
  ivory: {
    ...SHARED,
    fillDay: hex("#e8e3d8"),
    lineDay: hex("#2b2925"),
    lineAlphaDay: 0.58,
  },
  moon: {
    ...SHARED,
    fillDay: hex("#d7d9d5"),
    lineDay: hex("#24262a"),
    lineAlphaDay: 0.58,
  },
  ice: {
    ...SHARED,
    fillDay: hex("#d9e4ec"),
    lineDay: hex("#26323c"),
    lineAlphaDay: 0.58,
  },
};

export const DEFAULT_GLOBE_PALETTE: GlobePaletteId = "ivory";
