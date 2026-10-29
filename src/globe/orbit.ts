// Globe coordinate math. Pure functions only: no DOM, no WebGL, so the same
// module runs under Node for tools/test-globe.ts.
//
// Earth-fixed right-handed frame: +Y is the north pole, lon 0° faces +Z,
// lon +90°E faces +X (x = cosφ·sinλ, y = sinφ, z = cosφ·cosλ).
import { subsolarPoint } from "../pet/solar.ts";

export type Vec3 = { x: number; y: number; z: number };
export type GeoPoint = { lat: number; lon: number };

const DEG = Math.PI / 180;
const WORLD_UP: Vec3 = { x: 0, y: 1, z: 0 };
const WORLD_FRONT: Vec3 = { x: 0, y: 0, z: 1 };
const POLAR_EPS = 1e-6;

export const DEFAULT_USER_PITCH_DEG = 9;

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function scale(v: Vec3, factor: number): Vec3 {
  return { x: v.x * factor, y: v.y * factor, z: v.z * factor };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function length(v: Vec3): number {
  return Math.hypot(v.x, v.y, v.z);
}

export function normalize(v: Vec3): Vec3 {
  const len = length(v);
  if (len < 1e-12) throw new RangeError("cannot normalize a zero vector");
  return scale(v, 1 / len);
}

export function geoToVector(lat: number, lon: number): Vec3 {
  const phi = lat * DEG;
  const lambda = lon * DEG;
  const cosPhi = Math.cos(phi);
  return {
    x: cosPhi * Math.sin(lambda),
    y: Math.sin(phi),
    z: cosPhi * Math.cos(lambda),
  };
}

export function vectorToGeo(v: Vec3): GeoPoint {
  const n = normalize(v);
  return {
    lat: Math.asin(Math.max(-1, Math.min(1, n.y))) / DEG,
    lon: Math.atan2(n.x, n.z) / DEG,
  };
}

export function subsolarVector(date: Date): Vec3 {
  const point = subsolarPoint(date);
  return geoToVector(point.lat, point.lon);
}

export function solarElevation(normal: Vec3, sun: Vec3): number {
  const cosine = dot(normalize(normal), normalize(sun));
  return Math.asin(Math.max(-1, Math.min(1, cosine))) / DEG;
}

export type ViewBasis = {
  right: Vec3;
  up: Vec3;
  // Toward the camera (the user point direction before pitch).
  back: Vec3;
  // Row-major world→camera matrix; rows are right/up/back.
  matrix: readonly number[];
  toCamera(v: Vec3): Vec3;
  fromCamera(v: Vec3): Vec3;
};

function projectOntoPlane(v: Vec3, normal: Vec3): Vec3 {
  return add(v, scale(normal, -dot(v, normal)));
}

// Positive pitch aims the camera slightly south of the point, so the point
// lands above the disk center (space-station framing).
export function buildViewBasis(
  lat: number,
  lon: number,
  pitchDeg: number = DEFAULT_USER_PITCH_DEG,
): ViewBasis {
  const back0 = geoToVector(lat, lon);
  let up0 = projectOntoPlane(WORLD_UP, back0);
  if (length(up0) < POLAR_EPS) up0 = projectOntoPlane(WORLD_FRONT, back0);
  up0 = normalize(up0);

  const right = normalize(cross(up0, back0));
  const pitch = pitchDeg * DEG;
  const cosPitch = Math.cos(pitch);
  const sinPitch = Math.sin(pitch);
  const up = add(scale(up0, cosPitch), scale(back0, sinPitch));
  const back = add(scale(up0, -sinPitch), scale(back0, cosPitch));

  return {
    right,
    up,
    back,
    matrix: [
      right.x,
      right.y,
      right.z,
      up.x,
      up.y,
      up.z,
      back.x,
      back.y,
      back.z,
    ],
    toCamera(v: Vec3): Vec3 {
      return { x: dot(v, right), y: dot(v, up), z: dot(v, back) };
    },
    fromCamera(v: Vec3): Vec3 {
      return add(add(scale(right, v.x), scale(up, v.y)), scale(back, v.z));
    },
  };
}
