// Low-precision geocentric Mars position from JPL approximate elements
// (Standish, valid A.D. 1800–2050, J2000 ecliptic). No dependencies.
import type { Vec3 } from "./orbit.ts";

const DEG = Math.PI / 180;
const J2000_MS = Date.UTC(2000, 0, 1, 12, 0, 0);
const MS_PER_DAY = 86_400_000;
const DAYS_PER_CENTURY = 36_525;
const OBLIQUITY = 23.4392911 * DEG;

type Elements = {
  a: number;
  e: number;
  i: number;
  L: number;
  peri: number;
  node: number;
};

export type MarsPosition = {
  direction: Vec3;
  distanceAu: number;
  eclipticLonDeg: number;
  eclipticLatDeg: number;
  sunLonDeg: number;
};

function centuriesSinceJ2000(date: Date): number {
  return (date.getTime() - J2000_MS) / MS_PER_DAY / DAYS_PER_CENTURY;
}

function normalizeDeg(value: number): number {
  return ((value % 360) + 360) % 360;
}

function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let eccentric = meanAnomaly;
  for (let i = 0; i < 8; i += 1) {
    eccentric -=
      (eccentric - eccentricity * Math.sin(eccentric) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentric));
  }
  return eccentric;
}

function heliocentric(elements: Elements): Vec3 {
  const meanAnomaly = (elements.L - elements.peri) * DEG;
  const eccentric = solveKepler(meanAnomaly, elements.e);
  const argument = (elements.peri - elements.node) * DEG;
  const node = elements.node * DEG;
  const inclination = elements.i * DEG;
  const trueAnomaly = Math.atan2(
    Math.sqrt(1 - elements.e * elements.e) * Math.sin(eccentric),
    Math.cos(eccentric) - elements.e,
  );
  const u = argument + trueAnomaly;
  const radius = elements.a * (1 - elements.e * Math.cos(eccentric));
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  const cosInc = Math.cos(inclination);
  const sinInc = Math.sin(inclination);
  const cosU = Math.cos(u);
  const sinU = Math.sin(u);
  return {
    x: radius * (cosNode * cosU - sinNode * sinU * cosInc),
    y: radius * (sinNode * cosU + cosNode * sinU * cosInc),
    z: radius * sinU * sinInc,
  };
}

function earthElements(T: number): Elements {
  return {
    a: 1.00000261 + 0.00000562 * T,
    e: 0.01671123 - 0.00004392 * T,
    i: -0.00001531 - 0.01294668 * T,
    L: normalizeDeg(100.46457166 + 35999.37244981 * T),
    peri: normalizeDeg(102.93768193 + 0.32327364 * T),
    node: 0,
  };
}

function marsElements(T: number): Elements {
  return {
    a: 1.52371034 + 0.00001847 * T,
    e: 0.0933941 + 0.00007882 * T,
    i: 1.84969142 - 0.00813131 * T,
    L: normalizeDeg(-4.55343205 + 19140.30268499 * T),
    peri: normalizeDeg(-23.94362959 + 0.44441088 * T),
    node: normalizeDeg(49.55953891 - 0.29257343 * T),
  };
}

export function marsPosition(date: Date): MarsPosition {
  const T = centuriesSinceJ2000(date);
  const earth = heliocentric(earthElements(T));
  const mars = heliocentric(marsElements(T));
  const x = mars.x - earth.x;
  const y = mars.y - earth.y;
  const z = mars.z - earth.z;
  const distanceAu = Math.hypot(x, y, z);
  const cosO = Math.cos(OBLIQUITY);
  const sinO = Math.sin(OBLIQUITY);
  return {
    direction: {
      x: x / distanceAu,
      y: (y * cosO - z * sinO) / distanceAu,
      z: (y * sinO + z * cosO) / distanceAu,
    },
    distanceAu,
    eclipticLonDeg: normalizeDeg((Math.atan2(y, x) / DEG)),
    eclipticLatDeg: (Math.asin(z / distanceAu) / DEG),
    sunLonDeg: normalizeDeg(Math.atan2(-earth.y, -earth.x) / DEG),
  };
}

export function marsAppearance(position: MarsPosition): {
  brightness: number;
  sizeCss: number;
} {
  const brightness = Math.max(
    0.45,
    Math.min(0.95, 1.15 - (position.distanceAu - 0.6) * 0.38),
  );
  return { brightness, sizeCss: 12 + brightness * 2 };
}
