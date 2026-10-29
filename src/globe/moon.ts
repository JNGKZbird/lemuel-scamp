// Low-precision geocentric Moon ephemeris (Schlyter / van Flandern–Pulkkinen,
// ~1–2 arcmin, no tables or dependencies). Earth-fixed direction uses GMST so
// the Moon can share the globe's sky frame with the Sun.
import {
  dot,
  geoToVector,
  subsolarVector,
  type Vec3,
} from "./orbit.ts";

const DEG = Math.PI / 180;
const EARTH_RADIUS_KM = 6378.14;
const EPOCH_MS = Date.UTC(1999, 11, 31, 0, 0, 0);

export type MoonPosition = {
  // Unit vector in the Earth-fixed frame used by orbit.ts.
  direction: Vec3;
  distanceKm: number;
  distanceEarthRadii: number;
  raDeg: number;
  decDeg: number;
  eclipticLonDeg: number;
  eclipticLatDeg: number;
  elongationDeg: number;
  phaseAngleDeg: number;
  illuminatedFraction: number;
};

function normalize360(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function normalize180(deg: number): number {
  const value = normalize360(deg + 180) - 180;
  return value === -180 ? 180 : value;
}

function daysSinceEpoch(date: Date): number {
  return (date.getTime() - EPOCH_MS) / 86_400_000;
}

function solveKepler(meanAnomaly: number, eccentricity: number): number {
  let eccentric = meanAnomaly + eccentricity * Math.sin(meanAnomaly) *
    (1 + eccentricity * Math.cos(meanAnomaly));
  for (let i = 0; i < 8; i += 1) {
    eccentric -=
      (eccentric - eccentricity * Math.sin(eccentric) - meanAnomaly) /
      (1 - eccentricity * Math.cos(eccentric));
  }
  return eccentric;
}

export function moonAltitude(date: Date, lat: number, lon: number): number {
  const up = geoToVector(lat, lon);
  const moon = moonPosition(date).direction;
  return Math.asin(Math.max(-1, Math.min(1, dot(moon, up)))) / DEG;
}

export function moonPosition(date: Date): MoonPosition {
  const d = daysSinceEpoch(date);

  // Moon orbital elements (Schlyter). Angles in degrees, distance in Earth radii.
  const nodeDeg = 125.1228 - 0.0529538083 * d;
  const inclinationDeg = 5.1454;
  const periDeg = 318.0634 + 0.1643573223 * d;
  const semiMajor = 60.2666;
  const eccentricity = 0.0549;
  const anomalyDeg = 115.3654 + 13.0649929509 * d;

  const anomaly = anomalyDeg * DEG;
  const eccentricAnomaly = solveKepler(anomaly, eccentricity);
  const xOrbit = semiMajor * (Math.cos(eccentricAnomaly) - eccentricity);
  const yOrbit =
    semiMajor * Math.sqrt(1 - eccentricity * eccentricity) *
    Math.sin(eccentricAnomaly);
  const trueAnomaly = Math.atan2(yOrbit, xOrbit);
  let radius = Math.hypot(xOrbit, yOrbit);

  const node = nodeDeg * DEG;
  const inclination = inclinationDeg * DEG;
  const argument = trueAnomaly + periDeg * DEG;
  const cosArgument = Math.cos(argument);
  const sinArgument = Math.sin(argument);
  const cosNode = Math.cos(node);
  const sinNode = Math.sin(node);
  const cosInclination = Math.cos(inclination);

  const xEcliptic = radius *
    (cosNode * cosArgument - sinNode * sinArgument * cosInclination);
  const yEcliptic = radius *
    (sinNode * cosArgument + cosNode * sinArgument * cosInclination);
  const zEcliptic = radius * sinArgument * Math.sin(inclination);

  let lonDeg = Math.atan2(yEcliptic, xEcliptic) / DEG;
  let latDeg = Math.atan2(
    zEcliptic,
    Math.hypot(xEcliptic, yEcliptic),
  ) / DEG;

  // Major lunar perturbations (degrees / Earth radii).
  const sunAnomalyDeg = 356.047 + 0.9856002585 * d;
  const sunPeriDeg = 282.9404 + 4.70935e-5 * d;
  const sunMeanLonDeg = sunAnomalyDeg + sunPeriDeg;
  const moonMeanLonDeg = anomalyDeg + periDeg + nodeDeg;
  const elongationDeg = moonMeanLonDeg - sunMeanLonDeg;
  const latitudeArgDeg = moonMeanLonDeg - nodeDeg;

  const sin = (value: number) => Math.sin(value * DEG);
  const cos = (value: number) => Math.cos(value * DEG);

  lonDeg +=
    -1.274 * sin(anomalyDeg - 2 * elongationDeg) +
    0.658 * sin(2 * elongationDeg) -
    0.186 * sin(sunAnomalyDeg) -
    0.059 * sin(2 * anomalyDeg - 2 * elongationDeg) -
    0.057 * sin(anomalyDeg - 2 * elongationDeg + sunAnomalyDeg) +
    0.053 * sin(anomalyDeg + 2 * elongationDeg) +
    0.046 * sin(2 * elongationDeg - sunAnomalyDeg) +
    0.041 * sin(anomalyDeg - sunAnomalyDeg) -
    0.035 * sin(elongationDeg) -
    0.031 * sin(anomalyDeg + sunAnomalyDeg) -
    0.015 * sin(2 * latitudeArgDeg - 2 * elongationDeg) +
    0.011 * sin(anomalyDeg - 4 * elongationDeg);

  latDeg +=
    -0.173 * sin(latitudeArgDeg - 2 * elongationDeg) -
    0.055 * sin(anomalyDeg - latitudeArgDeg - 2 * elongationDeg) -
    0.046 * sin(anomalyDeg + latitudeArgDeg - 2 * elongationDeg) +
    0.033 * sin(latitudeArgDeg + 2 * elongationDeg) +
    0.017 * sin(2 * anomalyDeg + latitudeArgDeg);

  radius +=
    -0.58 * cos(anomalyDeg - 2 * elongationDeg) -
    0.46 * cos(2 * elongationDeg);

  const lon = lonDeg * DEG;
  const lat = latDeg * DEG;
  const x = radius * Math.cos(lat) * Math.cos(lon);
  const y = radius * Math.cos(lat) * Math.sin(lon);
  const z = radius * Math.sin(lat);

  const obliquity = (23.4393 - 3.563e-7 * d) * DEG;
  const yEquatorial = y * Math.cos(obliquity) - z * Math.sin(obliquity);
  const zEquatorial = y * Math.sin(obliquity) + z * Math.cos(obliquity);
  const raDeg = normalize360(Math.atan2(yEquatorial, x) / DEG);
  const decDeg = Math.atan2(
    zEquatorial,
    Math.hypot(x, yEquatorial),
  ) / DEG;

  // GMST from the same solar mean longitude used by the perturbations.
  const utcHours =
    date.getUTCHours() +
    date.getUTCMinutes() / 60 +
    date.getUTCSeconds() / 3600 +
    date.getUTCMilliseconds() / 3_600_000;
  const gmstDeg = normalize360(sunMeanLonDeg + 180 + 15 * utcHours);
  const earthFixedLonDeg = normalize180(raDeg - gmstDeg);
  const direction = geoToVector(decDeg, earthFixedLonDeg);

  const elongationRad = Math.acos(
    Math.max(-1, Math.min(1, dot(direction, subsolarVector(date)))),
  );
  const phaseAngleDeg = 180 - elongationRad / DEG;
  const illuminatedFraction = (1 - Math.cos(elongationRad)) / 2;

  return {
    direction,
    distanceKm: radius * EARTH_RADIUS_KM,
    distanceEarthRadii: radius,
    raDeg,
    decDeg,
    eclipticLonDeg: normalize360(lonDeg),
    eclipticLatDeg: latDeg,
    elongationDeg: elongationRad / DEG,
    phaseAngleDeg,
    illuminatedFraction,
  };
}
