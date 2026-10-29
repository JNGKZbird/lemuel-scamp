import type { Gear } from "../settings/store";

export type Behavior = {
  idleMin: number;
  idleMax: number;
  pWalk: number;
  pSit: number;
  pSleep: number;
  walkMin: number;
  walkMax: number;
  sleepMin: number;
  sleepMax: number;
};

export const GEAR_PRESETS: Record<Gear, Behavior> = {
  quiet: {
    idleMin: 6,
    idleMax: 12,
    pWalk: 0.2,
    pSit: 0.15,
    pSleep: 0.04,
    walkMin: 60,
    walkMax: 180,
    sleepMin: 15,
    sleepMax: 30,
  },
  standard: {
    idleMin: 3,
    idleMax: 8,
    pWalk: 0.45,
    pSit: 0.12,
    pSleep: 0.05,
    walkMin: 120,
    walkMax: 320,
    sleepMin: 15,
    sleepMax: 30,
  },
  active: {
    idleMin: 1.5,
    idleMax: 4,
    pWalk: 0.65,
    pSit: 0.06,
    pSleep: 0.02,
    walkMin: 200,
    walkMax: 480,
    sleepMin: 12,
    sleepMax: 24,
  },
};
