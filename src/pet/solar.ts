// NOAA solar position approximations. Accuracy is within a couple of minutes.
// All instants are computed in UTC; longitude is positive east.

import { seasonFactor } from "./season.ts";

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const DEG = Math.PI / 180;

const SUNRISE_ALTITUDE = -0.833;
const CIVIL_ALTITUDE = -6;
const EARLY_LIGHT_ALTITUDE = 6;

const FALLBACK_WINDOWS = {
  dawnMinutes: 90,
  noonMinutes: 60,
  duskMinutes: 90,
};

export type PolarState = "day" | "night" | null;

export type SolarDay = {
  solarNoon: Date;
  midnightBefore: Date;
  midnightAfter: Date;
  sunrise: Date | null;
  sunset: Date | null;
  civilDawn: Date | null;
  civilDusk: Date | null;
  morningEnd: Date | null;
  eveningStart: Date | null;
  polar: PolarState;
  dayLengthMs: number;
};

export type PhaseId =
  | "lateNight"
  | "dawn"
  | "day"
  | "noon"
  | "evening"
  | "night"
  | "polarActive"
  | "polarQuiet";

export type PhaseOptions = {
  // Used only by the polar 12-hour split. Defaults to round(longitude / 15).
  utcOffsetMinutes?: number;
};

export type PhaseInfo = {
  phase: PhaseId;
  solar: SolarDay;
  nextChange: Date | null;
};

type SolarParams = {
  declination: number;
  eqTime: number;
};

function assertCoordinates(latitude: number, longitude: number): void {
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90) {
    throw new RangeError(`latitude out of range: ${latitude}`);
  }
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
    throw new RangeError(`longitude out of range: ${longitude}`);
  }
}

function solarParams(date: Date): SolarParams {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 0);
  const dayOfYear = Math.floor((date.getTime() - yearStart) / DAY_MS);
  const hour =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600;
  const gamma = ((2 * Math.PI) / 365) * (dayOfYear - 1 + (hour - 12) / 24);

  const eqTime =
    229.18 *
    (0.000075 +
      0.001868 * Math.cos(gamma) -
      0.032077 * Math.sin(gamma) -
      0.014615 * Math.cos(2 * gamma) -
      0.040849 * Math.sin(2 * gamma));

  const declination =
    0.006918 -
    0.399912 * Math.cos(gamma) +
    0.070257 * Math.sin(gamma) -
    0.006758 * Math.cos(2 * gamma) +
    0.000907 * Math.sin(2 * gamma) -
    0.002697 * Math.cos(3 * gamma) +
    0.00148 * Math.sin(3 * gamma);

  return { declination, eqTime };
}

function utcDayStart(ms: number): number {
  const date = new Date(ms);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
}

function solarNoonUTC(dayStart: number, longitude: number): number {
  const noonBase = dayStart + 12 * HOUR_MS;
  const first = solarParams(new Date(noonBase));
  let noon = noonBase - (first.eqTime + 4 * longitude) * MINUTE_MS;
  const refined = solarParams(new Date(noon));
  noon = noonBase - (refined.eqTime + 4 * longitude) * MINUTE_MS;
  return noon;
}

function nearestSolarNoon(nowMs: number, longitude: number): number {
  const base = utcDayStart(nowMs);
  let best = base;
  let bestDistance = Infinity;
  for (const offset of [-1, 0, 1]) {
    const noon = solarNoonUTC(base + offset * DAY_MS, longitude);
    const distance = Math.abs(noon - nowMs);
    if (distance < bestDistance) {
      best = noon;
      bestDistance = distance;
    }
  }
  return best;
}

function timeAtAltitude(
  noonMs: number,
  latitude: number,
  altitudeDeg: number,
  rising: boolean,
): Date | null {
  const { declination } = solarParams(new Date(noonMs));
  const phi = latitude * DEG;
  const target = altitudeDeg * DEG;
  const cosHourAngle =
    (Math.sin(target) - Math.sin(phi) * Math.sin(declination)) /
    (Math.cos(phi) * Math.cos(declination));
  if (cosHourAngle < -1 || cosHourAngle > 1) return null;
  const hourAngle = Math.acos(cosHourAngle);
  const offsetMs = (hourAngle / DEG / 15) * HOUR_MS;
  return new Date(rising ? noonMs - offsetMs : noonMs + offsetMs);
}

export function getSolarDay(
  now: Date,
  latitude: number,
  longitude: number,
): SolarDay {
  assertCoordinates(latitude, longitude);
  const lat = Math.max(-89.9999, Math.min(89.9999, latitude));
  const noonMs = nearestSolarNoon(now.getTime(), longitude);

  const sunrise = timeAtAltitude(noonMs, lat, SUNRISE_ALTITUDE, true);
  const sunset = timeAtAltitude(noonMs, lat, SUNRISE_ALTITUDE, false);

  let polar: PolarState = null;
  if (sunrise === null || sunset === null) {
    const noonAltitude = solarAltitude(new Date(noonMs), lat, longitude);
    polar = noonAltitude > 0 ? "day" : "night";
  }

  return {
    solarNoon: new Date(noonMs),
    midnightBefore: new Date(noonMs - 12 * HOUR_MS),
    midnightAfter: new Date(noonMs + 12 * HOUR_MS),
    sunrise,
    sunset,
    civilDawn: timeAtAltitude(noonMs, lat, CIVIL_ALTITUDE, true),
    civilDusk: timeAtAltitude(noonMs, lat, CIVIL_ALTITUDE, false),
    morningEnd: timeAtAltitude(noonMs, lat, EARLY_LIGHT_ALTITUDE, true),
    eveningStart: timeAtAltitude(noonMs, lat, EARLY_LIGHT_ALTITUDE, false),
    polar,
    dayLengthMs:
      sunrise !== null && sunset !== null
        ? sunset.getTime() - sunrise.getTime()
        : 0,
  };
}

export function solarAltitude(
  date: Date,
  latitude: number,
  longitude: number,
): number {
  assertCoordinates(latitude, longitude);
  const lat = Math.max(-89.9999, Math.min(89.9999, latitude));
  const { declination, eqTime } = solarParams(date);
  const utcMinutes =
    date.getUTCHours() * 60 +
    date.getUTCMinutes() +
    date.getUTCSeconds() / 60 +
    date.getUTCMilliseconds() / MINUTE_MS;
  let trueSolarMinutes = (utcMinutes + eqTime + 4 * longitude) % 1440;
  if (trueSolarMinutes < 0) trueSolarMinutes += 1440;
  const hourAngle = (trueSolarMinutes / 4 - 180) * DEG;
  const phi = lat * DEG;
  const sinAltitude =
    Math.sin(phi) * Math.sin(declination) +
    Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle);
  return Math.asin(Math.max(-1, Math.min(1, sinAltitude))) / DEG;
}

export type SubsolarPoint = { lat: number; lon: number };

// Sub-solar point (sun directly overhead). Longitude: 180° − 15°/h · UTC − eqTime/4.
export function subsolarPoint(date: Date): SubsolarPoint {
  const { declination, eqTime } = solarParams(date);
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / HOUR_MS;
  let lon = 180 - 15 * utcHours - eqTime / 4;
  lon = (((lon + 180) % 360) + 360) % 360 - 180;
  return { lat: declination / DEG, lon };
}

function polarSplit(
  now: Date,
  utcOffsetMinutes: number,
): { phase: PhaseId; nextChange: Date } {
  const shifted = now.getTime() + utcOffsetMinutes * MINUTE_MS;
  const dayStart = Math.floor(shifted / DAY_MS) * DAY_MS;
  const localMs = shifted - dayStart;
  const activeStart = 8 * HOUR_MS;
  const activeEnd = 20 * HOUR_MS;
  const active = localMs >= activeStart && localMs < activeEnd;
  let nextLocalMs: number;
  if (localMs < activeStart) {
    nextLocalMs = activeStart;
  } else if (localMs < activeEnd) {
    nextLocalMs = activeEnd;
  } else {
    nextLocalMs = DAY_MS + activeStart;
  }
  return {
    phase: active ? "polarActive" : "polarQuiet",
    nextChange: new Date(dayStart + nextLocalMs - utcOffsetMinutes * MINUTE_MS),
  };
}

export function getPhase(
  now: Date,
  latitude: number,
  longitude: number,
  options: PhaseOptions = {},
): PhaseInfo {
  const solar = getSolarDay(now, latitude, longitude);
  const utcOffsetMinutes =
    options.utcOffsetMinutes ?? Math.round(longitude / 15) * 60;

  if (solar.polar) {
    const split = polarSplit(now, utcOffsetMinutes);
    return {
      phase: split.phase,
      solar,
      nextChange: split.nextChange,
    };
  }

  const lightStartMs = (solar.civilDawn ?? solar.sunrise!).getTime();
  const lightEndMs = (solar.civilDusk ?? solar.sunset!).getTime();
  const noonMs = solar.solarNoon.getTime();
  const lightMs = lightEndMs - lightStartMs;

  const desiredMs =
    (FALLBACK_WINDOWS.dawnMinutes +
      2 * FALLBACK_WINDOWS.noonMinutes +
      FALLBACK_WINDOWS.duskMinutes) *
    MINUTE_MS;
  const scale = lightMs < desiredMs ? lightMs / desiredMs : 1;
  const noonHalfMs = FALLBACK_WINDOWS.noonMinutes * MINUTE_MS * scale;
  const noonStartMs = noonMs - noonHalfMs;
  const noonEndMs = noonMs + noonHalfMs;

  const fallbackMorningEndMs =
    lightStartMs + FALLBACK_WINDOWS.dawnMinutes * MINUTE_MS * scale;
  const fallbackEveningStartMs =
    lightEndMs - FALLBACK_WINDOWS.duskMinutes * MINUTE_MS * scale;

  const naturalMorningEndMs = solar.morningEnd?.getTime();
  const naturalEveningStartMs = solar.eveningStart?.getTime();

  const morningEndMs = Math.max(
    lightStartMs,
    Math.min(
      naturalMorningEndMs ?? fallbackMorningEndMs,
      noonStartMs,
      lightEndMs,
    ),
  );
  const eveningStartMs = Math.min(
    lightEndMs,
    Math.max(
      naturalEveningStartMs ?? fallbackEveningStartMs,
      noonEndMs,
      lightStartMs,
    ),
  );

  const seasonal = seasonFactor(solar.dayLengthMs / HOUR_MS);
  const sleepOnsetMs = Math.max(
    lightEndMs,
    solar.midnightAfter.getTime() -
      60 * MINUTE_MS +
      30 * MINUTE_MS * seasonal,
  );

  const nowMs = now.getTime();
  let phase: PhaseId;
  if (nowMs < lightStartMs) {
    phase = "lateNight";
  } else if (nowMs < morningEndMs) {
    phase = "dawn";
  } else if (nowMs < noonStartMs) {
    phase = "day";
  } else if (nowMs < noonEndMs) {
    phase = "noon";
  } else if (nowMs < eveningStartMs) {
    phase = "day";
  } else if (nowMs < lightEndMs) {
    phase = "evening";
  } else if (nowMs < sleepOnsetMs) {
    phase = "night";
  } else {
    phase = "lateNight";
  }

  const boundaries = [
    lightStartMs,
    morningEndMs,
    noonStartMs,
    noonEndMs,
    eveningStartMs,
    lightEndMs,
    sleepOnsetMs,
    solar.midnightAfter.getTime(),
  ];
  const next = boundaries.find((boundary) => boundary > nowMs);

  return {
    phase,
    solar,
    nextChange: next === undefined ? null : new Date(next),
  };
}
