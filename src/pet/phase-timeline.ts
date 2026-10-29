import { getPhase } from "./solar.ts";
import type { PhaseId } from "./solar.ts";

export type PhaseBlock = {
  start: number;
  end: number;
  phase: PhaseId;
};

export const PHASE_LABELS: Record<PhaseId, string> = {
  lateNight: "凌晨",
  dawn: "清晨",
  day: "白天",
  noon: "中午",
  evening: "傍晚",
  night: "晚上",
  polarActive: "极地活跃",
  polarQuiet: "极地安静",
};

export const PHASE_COLORS: Record<PhaseId, string> = {
  lateNight: "#1e3a5f",
  dawn: "#e7b84b",
  day: "#7db7e8",
  noon: "#e88a52",
  evening: "#c97b63",
  night: "#4b5d8a",
  polarActive: "#7db7e8",
  polarQuiet: "#4b5d8a",
};

export function buildPhaseTimeline(
  ms: number,
  lat: number,
  lon: number,
): PhaseBlock[] {
  const base = new Date(ms);
  base.setHours(0, 0, 0, 0);
  const start = base.getTime();
  const blocks: PhaseBlock[] = [];
  let blockStart = 0;
  let blockPhase = getPhase(new Date(start), lat, lon).phase;
  for (let minute = 5; minute <= 1440; minute += 5) {
    const phase = getPhase(new Date(start + minute * 60_000), lat, lon).phase;
    if (phase !== blockPhase) {
      blocks.push({ start: blockStart, end: minute, phase: blockPhase });
      blockStart = minute;
      blockPhase = phase;
    }
  }
  blocks.push({ start: blockStart, end: 1440, phase: blockPhase });
  return blocks;
}
