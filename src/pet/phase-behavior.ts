import type { PhaseId } from "./solar.ts";
import { seasonFactor } from "./season.ts";

export type PhaseBehavior = {
  idleMin: number;
  idleMax: number;
  pWalk: number;
  pSit: number;
  pSleep: number;
  walkMin: number;
  walkMax: number;
  sleepMin: number;
  sleepMax: number;
  nap: boolean;
};

// Walk ranges are placeholders until the 2D full-screen movement controller
// lands; they are only used for rhythm simulation today.
const lateNight: PhaseBehavior = {
  idleMin: 8,
  idleMax: 15,
  pWalk: 0.1,
  pSit: 0,
  pSleep: 0.65,
  walkMin: 80,
  walkMax: 220,
  sleepMin: 60,
  sleepMax: 180,
  nap: false,
};

const dawn: PhaseBehavior = {
  idleMin: 2,
  idleMax: 6,
  pWalk: 0.6,
  pSit: 0.08,
  pSleep: 0,
  walkMin: 150,
  walkMax: 380,
  sleepMin: 0,
  sleepMax: 0,
  nap: false,
};

const day: PhaseBehavior = {
  idleMin: 3,
  idleMax: 8,
  pWalk: 0.45,
  pSit: 0.15,
  pSleep: 0,
  walkMin: 120,
  walkMax: 320,
  sleepMin: 0,
  sleepMax: 0,
  nap: false,
};

const noon: PhaseBehavior = {
  idleMin: 3,
  idleMax: 8,
  pWalk: 0.35,
  pSit: 0.2,
  pSleep: 0.05,
  walkMin: 100,
  walkMax: 260,
  sleepMin: 15,
  sleepMax: 25,
  nap: true,
};

const evening: PhaseBehavior = {
  idleMin: 2,
  idleMax: 6,
  pWalk: 0.55,
  pSit: 0.1,
  pSleep: 0,
  walkMin: 150,
  walkMax: 380,
  sleepMin: 0,
  sleepMax: 0,
  nap: false,
};

const night: PhaseBehavior = {
  idleMin: 5,
  idleMax: 10,
  pWalk: 0.25,
  pSit: 0.08,
  pSleep: 0.02,
  walkMin: 80,
  walkMax: 220,
  sleepMin: 10,
  sleepMax: 20,
  nap: false,
};

const BEHAVIOR: Record<PhaseId, PhaseBehavior> = {
  lateNight,
  dawn,
  day,
  noon,
  evening,
  night,
  polarActive: day,
  polarQuiet: night,
};

const NAP_BASE_P_SLEEP = 0.05;
const NAP_SEASONAL_P_SLEEP = 0.04;
const NAP_MIN_P_SLEEP = 0.01;
const NAP_MAX_P_SLEEP = 0.12;

export function getPhaseBehavior(
  phase: PhaseId,
  dayLengthHours?: number,
): PhaseBehavior {
  const base = BEHAVIOR[phase];
  if (phase !== "noon" || dayLengthHours === undefined) return base;
  const seasonal = seasonFactor(dayLengthHours);
  const pSleep = Math.max(
    NAP_MIN_P_SLEEP,
    Math.min(
      NAP_MAX_P_SLEEP,
      NAP_BASE_P_SLEEP + NAP_SEASONAL_P_SLEEP * seasonal,
    ),
  );
  return { ...base, pSleep };
}

export function allowsSleep(phase: PhaseId): boolean {
  return BEHAVIOR[phase].pSleep > 0;
}

export function isNapPhase(phase: PhaseId): boolean {
  return BEHAVIOR[phase].nap;
}
