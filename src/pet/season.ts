// Positive in long-day seasons, negative in short-day seasons.
// Southern hemisphere follows automatically because day length does.
export function seasonFactor(dayLengthHours: number): number {
  return Math.max(-1, Math.min(1, (dayLengthHours - 12) / 4));
}

export type SeasonId = "spring" | "summer" | "autumn" | "winter";

export const SEASON_LABELS: Record<SeasonId, string> = {
  spring: "春",
  summer: "夏",
  autumn: "秋",
  winter: "冬",
};

// Meteorological seasons by Gregorian month; reversed in the southern hemisphere.
export function seasonId(date: Date, latitude: number): SeasonId {
  const month = date.getMonth();
  let season: SeasonId;
  if (month === 11 || month <= 1) season = "winter";
  else if (month <= 4) season = "spring";
  else if (month <= 7) season = "summer";
  else season = "autumn";
  if (latitude < 0) {
    const flipped: Record<SeasonId, SeasonId> = {
      spring: "autumn",
      summer: "winter",
      autumn: "spring",
      winter: "summer",
    };
    season = flipped[season];
  }
  return season;
}

export function seasonLabel(date: Date, latitude: number): string {
  return SEASON_LABELS[seasonId(date, latitude)];
}
