import {
  add,
  buildViewBasis,
  dot,
  geoToVector,
  scale,
  subsolarVector,
  type Vec3,
  type ViewBasis,
} from "./orbit.ts";
import type { GlobePalette, Rgb } from "./palette.ts";
import { marsAppearance, marsPosition } from "./planets.ts";
import { moonPosition } from "./moon.ts";

export type GlobeScene = {
  date: Date;
  lat: number;
  lon: number;
  palette: GlobePalette;
  terminatorWidthDeg: number;
  terminatorStrength: number;
  sunCorePx: number;
  sunBloomPx: number;
  sunIntensity: number;
  sunFlare: number;
  sunViewFalloff: number;
  moonSizePx?: number;
  moonDarkLevel?: number;
};

type Options = {
  onFallback?: (reason: string) => void;
};

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

uniform vec2 u_center;
uniform float u_radius;
uniform float u_dpr;

uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_back;

uniform vec3 u_sun;
uniform vec3 u_user;
uniform float u_userLat;
uniform float u_userLon;

uniform vec3 u_fillDay;
uniform vec3 u_fillNight;
uniform vec3 u_lineDay;
uniform vec3 u_lineNight;
uniform float u_lineAlphaDay;
uniform float u_lineAlphaNight;
uniform float u_secondaryAlpha;
uniform vec3 u_accent;
uniform float u_accentAlpha;
uniform vec3 u_terminator;
uniform float u_termStrength;
uniform float u_twilightHalf;
uniform vec3 u_rim;
uniform float u_rimAlpha;
uniform vec3 u_marker;
uniform vec3 u_markerRing;

uniform float u_sunCore;
uniform float u_sunBloom;
uniform float u_sunIntensity;
uniform float u_sunFlare;
uniform float u_sunViewFalloff;
uniform vec2 u_skyHalf;
uniform vec3 u_moon;
uniform float u_moonSize;
uniform float u_moonDark;

const float PI = 3.141592653589793;
const float RAD_TO_DEG = 180.0 / PI;

float lineMask(float distDeg, float degPerCssPx, float halfWidthCss) {
  float px = distDeg / max(degPerCssPx, 1e-5);
  return 1.0 - smoothstep(halfWidthCss, halfWidthCss + 1.0, px);
}

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
}

void main() {
  vec2 p = gl_FragCoord.xy - u_center;
  float radiusNorm = length(p) / u_radius;
  float edgeWidth = (1.25 * u_dpr) / u_radius;
  float disk = 1.0 - smoothstep(1.0 - edgeWidth, 1.0, radiusNorm);

  vec2 q = p / u_radius;
  vec3 bgColor = vec3(0.0);
  float bgAlpha = 0.0;

  vec3 sunCam = vec3(
    dot(u_sun, u_right),
    dot(u_sun, u_up),
    dot(u_sun, u_back)
  );
  // 日轮出画时，光晕仍可能扫进画面：裁剪边界取到视口矩形之外，
  // 再按太阳中心到视口的距离淡出，而不是日轮一越界就整组消失。
  if (sunCam.z < 0.62) {
    float sunTheta = acos(clamp(-sunCam.z, -1.0, 1.0));
    vec2 sunDir = normalize(sunCam.xy + vec2(1e-6));
    float sunSide = sunTheta / (PI * 0.5);
    float viewDim = 1.0 - u_sunViewFalloff * min(sunSide, 1.0);
    vec2 sunRaw = u_center + sunDir * sunSide * u_skyHalf;
    vec2 sunOutside = max(abs(sunRaw - u_center) - u_skyHalf, 0.0);
    float sunReach = max(u_sunBloom * 3.0, u_sunCore * 8.0) * u_dpr;
    float sunFade = 1.0 - smoothstep(
      sunReach * 0.72,
      sunReach,
      length(sunOutside)
    );
    sunFade *= 1.0 - smoothstep(0.38, 0.60, sunCam.z);
    vec2 sunDelta = (gl_FragCoord.xy - sunRaw) / u_dpr;
    float sunPx = length(sunDelta);
    float core = 1.0 - smoothstep(u_sunCore * 0.55, u_sunCore, sunPx);
    float inner = exp(-pow(sunPx / max(u_sunCore * 2.8, 0.1), 2.0)) * 0.75;
    float outer = exp(-pow(sunPx / max(u_sunBloom, 0.1), 2.0)) * 0.32;
    float spikeH = exp(-abs(sunDelta.y) / 0.8) *
      exp(-abs(sunDelta.x) / (max(u_sunBloom, 0.1) * 1.4)) * 0.22;
    float spikeV = exp(-abs(sunDelta.x) / 0.8) *
      exp(-abs(sunDelta.y) / (max(u_sunBloom, 0.1) * 1.4)) * 0.16;
    float flare = (spikeH + spikeV) * u_sunFlare;
    float sunAlpha = clamp(
      (core + inner + outer + flare) * viewDim * u_sunIntensity,
      0.0,
      1.0
    );
    sunAlpha *= sunFade;
    vec3 coreColor = vec3(1.0);
    vec3 innerColor = vec3(1.0, 0.93, 0.8);
    vec3 outerColor = vec3(1.0, 0.88, 0.72);
    vec3 sunColor = mix(
      coreColor,
      innerColor,
      smoothstep(0.0, u_sunCore, sunPx)
    );
    sunColor = mix(
      sunColor,
      outerColor,
      smoothstep(u_sunCore, max(u_sunBloom, u_sunCore + 0.1), sunPx)
    );
    vec3 sunRgb = sunColor * sunAlpha;
    bgColor = sunRgb + bgColor * (1.0 - sunAlpha);
    bgAlpha = sunAlpha + bgAlpha * (1.0 - sunAlpha);
  }

  // 月面：近地视角只看正面；用太阳在屏幕上的方向切出明暗椭圆。
  vec3 moonCam = vec3(
    dot(u_moon, u_right),
    dot(u_moon, u_up),
    dot(u_moon, u_back)
  );
  if (u_moonSize > 0.0 && moonCam.z < 0.62) {
    float moonTheta = acos(clamp(-moonCam.z, -1.0, 1.0));
    vec2 moonDir = normalize(moonCam.xy + vec2(1e-6));
    float moonSide = moonTheta / (PI * 0.5);
    vec2 moonRaw = u_center + moonDir * moonSide * u_skyHalf;
    float moonRadius = u_moonSize * 0.5;
    vec2 moonDelta = (gl_FragCoord.xy - moonRaw) / u_dpr;
    float moonPx = length(moonDelta);
    float moonMask = 1.0 - smoothstep(
      moonRadius - 0.6,
      moonRadius + 0.6,
      moonPx
    );
    if (moonMask > 0.0) {
      vec3 sunCamMoon = vec3(
        dot(u_sun, u_right),
        dot(u_sun, u_up),
        dot(u_sun, u_back)
      );
      float sunThetaMoon = acos(clamp(-sunCamMoon.z, -1.0, 1.0));
      vec2 sunDirMoon = normalize(sunCamMoon.xy + vec2(1e-6));
      vec2 sunRawMoon = u_center + sunDirMoon *
        (sunThetaMoon / (PI * 0.5)) * u_skyHalf;
      vec2 toSun = sunRawMoon - moonRaw;
      if (length(toSun) < 1e-3) toSun = vec2(1.0, 0.0);
      vec2 sunScreenDir = normalize(toSun);
      vec2 sunScreenPerp = vec2(-sunScreenDir.y, sunScreenDir.x);
      float phaseCos = clamp(-dot(u_sun, u_moon), -1.0, 1.0);
      float alongSun = dot(moonDelta, sunScreenDir);
      float acrossSun = dot(moonDelta, sunScreenPerp);
      float terminator = -phaseCos *
        sqrt(max(moonRadius * moonRadius - acrossSun * acrossSun, 0.0));
      float moonLit = smoothstep(
        terminator - 0.7,
        terminator + 0.7,
        alongSun
      );
      vec3 moonLitColor = vec3(0.93, 0.92, 0.88);
      vec3 moonDarkColor = vec3(0.55, 0.62, 0.72) * u_moonDark;
      vec3 moonColor = mix(moonDarkColor, moonLitColor, moonLit);
      bgColor = moonColor * moonMask + bgColor * (1.0 - moonMask);
      bgAlpha = moonMask + bgAlpha * (1.0 - moonMask);
    }
  }

  vec3 limbNormal = vec3(0.0, 0.0, 1.0);
  if (length(p) > 1e-3) {
    vec2 dir = p / length(p);
    limbNormal = normalize(u_right * dir.x + u_up * dir.y);
  }
  float limbSun = dot(limbNormal, u_sun);
  float limbSunset = smoothstep(0.18, -0.02, limbSun) *
    smoothstep(-0.28, 0.02, limbSun);
  float outsidePx = max(radiusNorm - 1.0, 0.0) * (u_radius / u_dpr);
  float limbHalo = exp(-pow(outsidePx / 9.0, 2.0)) * limbSunset * 0.22;
  vec3 limbGlowColor = mix(u_terminator, vec3(1.0), 0.35);
  bgColor = limbGlowColor * limbHalo + bgColor * (1.0 - limbHalo);
  bgAlpha = limbHalo + bgAlpha * (1.0 - limbHalo);

  if (disk <= 0.0) {
    gl_FragColor = vec4(bgColor, bgAlpha);
    return;
  }

  float nz = sqrt(max(1.0 - dot(q, q), 0.0));
  vec3 nCam = vec3(q, nz);
  vec3 n = normalize(u_right * nCam.x + u_up * nCam.y + u_back * nCam.z);

  float latRad = asin(clamp(n.y, -1.0, 1.0));
  float latDeg = latRad * RAD_TO_DEG;
  float lonDeg = atan(n.x, n.z) * RAD_TO_DEG;
  float cosLat = cos(latRad);

  float sunDot = dot(n, u_sun);
  float halfT = max(u_twilightHalf, 0.005);
  float daylight = smoothstep(-0.77 * halfT, 1.23 * halfT, sunDot);
  float sunset = smoothstep(0.3 * halfT, -0.3 * halfT, sunDot) *
    smoothstep(-0.9 * halfT, 0.3 * halfT, sunDot);
  float limbFade = smoothstep(0.02, 0.16, nz);
  float degPerPx = (1.0 / max(u_radius * max(nz, 0.04), 1.0)) * RAD_TO_DEG;
  float degPerCss = degPerPx * u_dpr;

  float dLat30 = abs(fract(latDeg / 30.0 + 0.5) - 0.5) * 30.0;
  float dLat15 = abs(fract(latDeg / 15.0 + 0.5) - 0.5) * 15.0;
  float dLon30 = abs(fract(lonDeg / 30.0 + 0.5) - 0.5) * 30.0 * cosLat;
  float dLon15 = abs(fract(lonDeg / 15.0 + 0.5) - 0.5) * 15.0 * cosLat;
  // 本初子午线：独立暖金虚线，替换掉 0° 处原来的实线网格。
  float primeLine = lineMask(abs(lonDeg), degPerCss, 0.5);
  float primeDash = step(0.5, fract((lonDeg + 180.0) / 4.0));
  float prime = primeLine * primeDash;

  float poleFade = 1.0 - smoothstep(84.0, 89.0, abs(latDeg));
  float meridianFade = smoothstep(0.04, 0.30, cosLat);
  float primary = max(
    lineMask(dLat30, degPerCss, 0.55),
    lineMask(dLon30, degPerCss, 0.55) * meridianFade
  );
  float secondary = max(
    lineMask(dLat15, degPerCss, 0.4),
    lineMask(dLon15, degPerCss, 0.4) * meridianFade
  );
  primary *= poleFade;
  secondary *= poleFade;
  primary *= 1.0 - primeLine;
  secondary *= 1.0 - primeLine;
  float equator = lineMask(abs(latDeg), degPerCss, 0.75) * 0.9;
  float dTropic = min(abs(latDeg - 23.4366), abs(latDeg + 23.4366));
  float tropicMask = lineMask(dTropic, degPerCss, 0.5);
  float tropicDash = step(0.5, fract((lonDeg + 180.0) / 5.0));
  float tropic = tropicMask * tropicDash;
  float grid = max(primary * 0.92, secondary * u_secondaryAlpha);
  grid = max(grid, equator);

  float dUserLat = abs(latDeg - u_userLat);
  float lonDelta = atan(
    sin(radians(lonDeg - u_userLon)),
    cos(radians(lonDeg - u_userLon))
  ) * RAD_TO_DEG;
  float dUserLon = abs(lonDelta) * cosLat;
  float userLine = max(
    lineMask(dUserLat, degPerCss, 0.5),
    lineMask(dUserLon, degPerCss, 0.5) * meridianFade
  );

  float markerAngle = acos(clamp(dot(n, u_user), -1.0, 1.0)) * RAD_TO_DEG;
  float markerPx = markerAngle / max(degPerCss, 1e-5);
  float markerDot = 1.0 - smoothstep(2.6, 3.4, markerPx);
  float markerRing = smoothstep(5.2, 6.0, markerPx) *
    (1.0 - smoothstep(6.8, 7.4, markerPx));

  vec3 color = mix(u_fillNight, u_fillDay, daylight);
  color = mix(color, u_terminator, sunset * u_termStrength);

  vec3 ink = mix(u_lineNight, u_lineDay, daylight);
  float lineAlpha = grid * mix(u_lineAlphaNight, u_lineAlphaDay, daylight) * limbFade;
  lineAlpha = max(
    lineAlpha,
    tropic * mix(0.16, 0.30, daylight) * limbFade
  );
  color = mix(color, ink, lineAlpha);
  float primeAlpha = prime * mix(0.22, 0.34, daylight) * limbFade;
  vec3 primeColor = mix(
    vec3(0.784, 0.643, 0.416),
    vec3(0.600, 0.440, 0.250),
    daylight
  );
  color = mix(color, primeColor, primeAlpha);
  color = mix(color, u_accent, userLine * u_accentAlpha * limbFade);

  float rimPx = abs(radiusNorm - 1.0) * (u_radius / u_dpr);
  float rim = 1.0 - smoothstep(0.2, 1.3, rimPx);
  color = mix(color, u_rim, rim * u_rimAlpha);

  float markerFade = smoothstep(0.01, 0.06, nz);
  color = mix(color, u_markerRing, markerRing * markerFade);
  color = mix(color, u_marker, markerDot * markerFade);

  float luma = max(color.r, max(color.g, color.b));
  color += (hash(gl_FragCoord.xy) - 0.5) / 255.0 * smoothstep(0.02, 0.2, luma);
  color = clamp(color, 0.0, 1.0);
  gl_FragColor = vec4(
    color * disk + bgColor * (1.0 - disk),
    disk + bgAlpha * (1.0 - disk)
  );
}
`;

const STAR_VERTEX_SHADER = `
attribute vec3 a_dir;
attribute vec3 a_style;

uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_back;
uniform vec2 u_center;
uniform float u_radius;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform vec3 u_tint;
uniform vec2 u_skyHalf;

varying vec3 v_color;
varying float v_alpha;

const float PI = 3.141592653589793;

void main() {
  vec3 cam = vec3(
    dot(a_dir, u_right),
    dot(a_dir, u_up),
    dot(a_dir, u_back)
  );
  if (cam.z >= -0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    v_alpha = 0.0;
    v_color = vec3(0.0);
    return;
  }
  float theta = acos(clamp(-cam.z, -1.0, 1.0));
  vec2 dir = normalize(cam.xy + vec2(1e-6));
  vec2 offset = dir * (theta / (PI * 0.5)) * u_skyHalf;
  float screenRadius = length(offset);
  float insideDisk = 1.0 - smoothstep(
    u_radius - 1.0,
    u_radius + 1.0,
    screenRadius
  );
  vec2 screen = u_center + offset;
  vec2 ndc = screen / u_resolution * 2.0 - 1.0;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = a_style.y * u_dpr;
  v_alpha = a_style.x * (1.0 - insideDisk);
  v_color = mix(
    vec3(0.82, 0.89, 0.97),
    vec3(1.0, 0.88, 0.72),
    a_style.z
  ) * u_tint;
}
`;

const STAR_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying vec3 v_color;
varying float v_alpha;
uniform float u_glow;

void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float starA = 1.0 - smoothstep(0.25, 1.0, r);
  float core = 1.0 - smoothstep(0.1, 0.28, r);
  float halo = exp(-pow(r / 0.55, 2.0)) * 0.32;
  float a = mix(starA, core + halo, u_glow) * v_alpha;
  a = min(a, 1.0);
  if (a <= 0.002) discard;
  gl_FragColor = vec4(v_color * a, a);
}
`;

const COASTLINE_VERTEX_SHADER = `
attribute vec3 a_a;
attribute vec3 a_b;
attribute vec2 a_style;

uniform vec3 u_right;
uniform vec3 u_up;
uniform vec3 u_back;
uniform vec3 u_sun;
uniform vec2 u_center;
uniform float u_radius;
uniform vec2 u_resolution;
uniform float u_dpr;
uniform float u_lineWidth;

varying float v_sunDot;
varying float v_side;

void main() {
  vec3 a = a_a;
  vec3 b = a_b;
  float za = dot(a, u_back);
  float zb = dot(b, u_back);
  if (za <= 0.0 && zb <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_sunDot = 0.0;
    v_side = 0.0;
    return;
  }
  if (za <= 0.0 || zb <= 0.0) {
    float denom = za - zb;
    float t = abs(denom) > 1e-6 ? clamp(za / denom, 0.0, 1.0) : 0.0;
    vec3 crossing = normalize(mix(a, b, t));
    if (za <= 0.0) a = crossing;
    if (zb <= 0.0) b = crossing;
  }

  vec3 camA = vec3(dot(a, u_right), dot(a, u_up), dot(a, u_back));
  vec3 camB = vec3(dot(b, u_right), dot(b, u_up), dot(b, u_back));
  vec2 screenA = u_center + camA.xy * u_radius;
  vec2 screenB = u_center + camB.xy * u_radius;
  vec2 delta = screenB - screenA;
  if (dot(delta, delta) < 1e-6) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    v_sunDot = 0.0;
    v_side = 0.0;
    return;
  }

  vec2 dir = normalize(delta);
  vec2 perp = vec2(-dir.y, dir.x);
  float end = a_style.x;
  float side = a_style.y * 2.0 - 1.0;
  vec2 screen = mix(screenA, screenB, end) +
    perp * side * u_lineWidth * u_dpr * 0.5;
  gl_Position = vec4(screen / u_resolution * 2.0 - 1.0, 0.0, 1.0);
  v_sunDot = mix(dot(a, u_sun), dot(b, u_sun), end);
  v_side = side;
}
`;

const COASTLINE_FRAGMENT_SHADER = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif

varying float v_sunDot;
varying float v_side;

uniform float u_twilightHalf;
uniform vec3 u_lineDay;
uniform vec3 u_lineNight;
uniform float u_coastAlphaDay;
uniform float u_coastAlphaNight;

void main() {
  float halfT = max(u_twilightHalf, 0.005);
  float daylight = smoothstep(-0.77 * halfT, 1.23 * halfT, v_sunDot);
  float alpha = mix(u_coastAlphaNight, u_coastAlphaDay, daylight);
  alpha *= 1.0 - smoothstep(0.45, 1.0, abs(v_side));
  if (alpha <= 0.002) discard;
  vec3 color = mix(u_lineNight, u_lineDay, daylight);
  gl_FragColor = vec4(color * alpha, alpha);
}
`;

// Personal map-pack archive; the public build ships no map data.
const ENABLE_COASTLINES = false;
const COASTLINE_LINE_WIDTH = 1.5;
const COASTLINE_ALPHA_DAY = 0.7;
const COASTLINE_ALPHA_NIGHT = 0.45;

const COASTLINE_UNIFORM_NAMES = [
  "u_right",
  "u_up",
  "u_back",
  "u_sun",
  "u_center",
  "u_radius",
  "u_resolution",
  "u_dpr",
  "u_lineWidth",
  "u_twilightHalf",
  "u_lineDay",
  "u_lineNight",
  "u_coastAlphaDay",
  "u_coastAlphaNight",
] as const;

type CoastlineUniformName = (typeof COASTLINE_UNIFORM_NAMES)[number];

const STAR_COUNT = 1600;

const STAR_UNIFORM_NAMES = [
  "u_right",
  "u_up",
  "u_back",
  "u_center",
  "u_radius",
  "u_resolution",
  "u_dpr",
  "u_tint",
  "u_glow",
  "u_skyHalf",
] as const;

type StarUniformName = (typeof STAR_UNIFORM_NAMES)[number];

function createStarData(count: number): Float32Array {
  const data = new Float32Array((count + 1) * 6);
  for (let i = 0; i < count; i += 1) {
    const z = Math.random() * 2 - 1;
    const phi = Math.random() * Math.PI * 2;
    const ring = Math.sqrt(Math.max(0, 1 - z * z));
    const brightness = 0.1 + Math.pow(Math.random(), 2.0) * 0.55;
    const size = 0.9 + brightness * 2.4;
    const warmth = Math.pow(Math.random(), 4) * 0.8;
    const offset = i * 6;
    data[offset] = ring * Math.cos(phi);
    data[offset + 1] = z;
    data[offset + 2] = ring * Math.sin(phi);
    data[offset + 3] = brightness;
    data[offset + 4] = size;
    data[offset + 5] = warmth;
  }
  const marsOffset = count * 6;
  data[marsOffset] = 0;
  data[marsOffset + 1] = 0;
  data[marsOffset + 2] = 1;
  data[marsOffset + 3] = 0;
  data[marsOffset + 4] = 2.6;
  data[marsOffset + 5] = 1;
  return data;
}

const UNIFORM_NAMES = [
  "u_center",
  "u_radius",
  "u_dpr",
  "u_right",
  "u_up",
  "u_back",
  "u_sun",
  "u_user",
  "u_userLat",
  "u_userLon",
  "u_fillDay",
  "u_fillNight",
  "u_lineDay",
  "u_lineNight",
  "u_lineAlphaDay",
  "u_lineAlphaNight",
  "u_secondaryAlpha",
  "u_accent",
  "u_accentAlpha",
  "u_terminator",
  "u_termStrength",
  "u_twilightHalf",
  "u_rim",
  "u_rimAlpha",
  "u_marker",
  "u_markerRing",
  "u_sunCore",
  "u_sunBloom",
  "u_sunIntensity",
  "u_sunFlare",
  "u_sunViewFalloff",
  "u_skyHalf",
  "u_moon",
  "u_moonSize",
  "u_moonDark",
] as const;

type UniformName = (typeof UNIFORM_NAMES)[number];

function wrapAngle(angle: number): number {
  const turn = Math.PI * 2;
  return (((angle + Math.PI) % turn) + turn) % turn - Math.PI;
}

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null {
  const shader = gl.createShader(type);
  if (!shader) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.error("[globe] shader", gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

function createProgram(
  gl: WebGLRenderingContext,
  vertexSource: string,
  fragmentSource: string,
  label: string,
): WebGLProgram | null {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  if (!vertex || !fragment) return null;
  const program = gl.createProgram();
  if (!program) return null;
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.error(`[globe] ${label} program`, gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
}

export class GlobeRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext | null = null;
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private uniforms: Record<UniformName, WebGLUniformLocation> | null = null;
  private positionLocation = -1;
  private starProgram: WebGLProgram | null = null;
  private starBuffer: WebGLBuffer | null = null;
  private starUniforms: Record<StarUniformName, WebGLUniformLocation> | null = null;
  private starDirLocation = -1;
  private starStyleLocation = -1;
  private coastlineProgram: WebGLProgram | null = null;
  private coastlineBuffer: WebGLBuffer | null = null;
  private coastlineIndexBuffer: WebGLBuffer | null = null;
  private coastlineUniforms: Record<CoastlineUniformName, WebGLUniformLocation> | null = null;
  private coastlineAA = -1;
  private coastlineAB = -1;
  private coastlineStyle = -1;
  private coastlineIndexCount = 0;
  private coastlineIndexType = 0;
  private coastlineLoaded = false;
  private readonly starData = createStarData(STAR_COUNT);
  private onFallback: ((reason: string) => void) | undefined;

  private scene: GlobeScene | null = null;
  private sun: Vec3 = { x: 0, y: 0, z: 1 };
  private user: Vec3 = { x: 0, y: 0, z: 1 };
  private baseBasis: ViewBasis | null = null;
  private baseLat = Number.NaN;
  private baseLon = Number.NaN;
  private marsDirection: Vec3 = { x: 0, y: 0, z: 1 };
  private twilightHalf = Math.sin((8 / 2) * (Math.PI / 180));
  private terminatorStrength = 0.28;
  private sunCorePx = 4;
  private sunBloomPx = 80;
  private sunIntensity = 1;
  private sunFlare = 0.9;
  private sunViewFalloff = 0.2;
  private moon: Vec3 = { x: 0, y: 0, z: -1 };
  private moonSizePx = 8;
  private moonDark = 0.2;

  private widthCss = 0;
  private heightCss = 0;
  private dpr = 1;
  private radiusCss = 1;
  private radiusPx = 1;
  private centerPx = { x: 0, y: 0 };

  private yaw = 0;
  private pitch = 0;
  private frame = 0;
  private resetFrame = 0;
  private dirty = true;
  private disposed = false;
  private contextLost = false;

  constructor(canvas: HTMLCanvasElement, options: Options = {}) {
    this.canvas = canvas;
    this.onFallback = options.onFallback;
    const gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: "low-power",
    });
    if (!gl) {
      this.onFallback?.("WebGL 不可用");
      return;
    }
    this.gl = gl;
    if (!this.initGL()) return;

    canvas.addEventListener("webglcontextlost", this.handleContextLost);
    canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("resize", this.handleWindowResize);

    this.resize(canvas.clientWidth, canvas.clientHeight);
  }

  get ready(): boolean {
    return this.gl !== null && this.program !== null;
  }

  resize(cssWidth: number, cssHeight: number): void {
    if (!this.gl) return;
    if (!Number.isFinite(cssWidth) || !Number.isFinite(cssHeight)) return;
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (width === this.widthCss && height === this.heightCss && dpr === this.dpr) {
      return;
    }
    this.widthCss = width;
    this.heightCss = height;
    this.dpr = dpr;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.radiusCss = Math.min(width, height) * 0.4;
    this.radiusPx = this.radiusCss * dpr;
    this.centerPx = { x: this.canvas.width / 2, y: this.canvas.height / 2 };
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.invalidate();
  }

  setScene(scene: GlobeScene): void {
    this.scene = scene;
    const width = Math.max(2, Math.min(20, scene.terminatorWidthDeg));
    const strength = Math.max(0, Math.min(0.6, scene.terminatorStrength));
    this.twilightHalf = Math.sin((width / 2) * (Math.PI / 180));
    this.terminatorStrength = strength;
    this.sunCorePx = Math.max(0.5, Math.min(40, scene.sunCorePx));
    this.sunBloomPx = Math.max(10, Math.min(200, scene.sunBloomPx));
    this.sunIntensity = Math.max(0, Math.min(2, scene.sunIntensity));
    this.sunFlare = Math.max(0, Math.min(2, scene.sunFlare));
    this.sunViewFalloff = Math.max(
      0,
      Math.min(0.8, scene.sunViewFalloff),
    );
    this.sun = subsolarVector(scene.date);
    this.moonSizePx = Math.max(6, Math.min(28, scene.moonSizePx ?? 8));
    this.moonDark = Math.max(0, Math.min(0.3, scene.moonDarkLevel ?? 0.2));
    this.moon = moonPosition(scene.date).direction;
    this.user = geoToVector(scene.lat, scene.lon);
    if (
      this.baseBasis === null ||
      scene.lat !== this.baseLat ||
      scene.lon !== this.baseLon
    ) {
      this.baseBasis = buildViewBasis(scene.lat, scene.lon);
      this.baseLat = scene.lat;
      this.baseLon = scene.lon;
      this.yaw = 0;
      this.pitch = 0;
    }

    const mars = marsPosition(scene.date);
    this.marsDirection = mars.direction;
    const look = marsAppearance(mars);
    const marsOffset = STAR_COUNT * 6;
    this.starData[marsOffset] = mars.direction.x;
    this.starData[marsOffset + 1] = mars.direction.y;
    this.starData[marsOffset + 2] = mars.direction.z;
    this.starData[marsOffset + 3] = look.brightness;
    this.starData[marsOffset + 4] = look.sizeCss;
    this.starData[marsOffset + 5] = 1;
    const gl = this.gl;
    if (gl && this.starBuffer && !this.contextLost) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
      gl.bufferSubData(
        gl.ARRAY_BUFFER,
        marsOffset * 4,
        this.starData.subarray(marsOffset, marsOffset + 6),
      );
    }
    this.invalidate();
  }

  dragBy(dx: number, dy: number): void {
    if (!this.baseBasis || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    if (this.resetFrame) {
      cancelAnimationFrame(this.resetFrame);
      this.resetFrame = 0;
    }
    const perPixel = Math.PI / (2 * Math.max(this.radiusCss, 1));
    this.yaw = wrapAngle(this.yaw + dx * perPixel);
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch + dy * perPixel));
    this.invalidate();
  }

  marsScreenPosition(): { x: number; y: number; visible: boolean } {
    const basis = this.baseBasis;
    if (!basis || this.dpr <= 0) return { x: 0, y: 0, visible: false };
    const rows = this.effectiveRows(basis);
    const cam = {
      x: dot(this.marsDirection, rows[0]),
      y: dot(this.marsDirection, rows[1]),
      z: dot(this.marsDirection, rows[2]),
    };
    if (cam.z >= -0.001) return { x: 0, y: 0, visible: false };
    const theta = Math.acos(Math.max(-1, Math.min(1, -cam.z)));
    const planar = Math.hypot(cam.x, cam.y);
    const dirX = planar > 1e-6 ? cam.x / planar : 0;
    const dirY = planar > 1e-6 ? cam.y / planar : 0;
    const scale = (theta / (Math.PI / 2));
    const offsetX = dirX * scale * (this.canvas.width / 2);
    const offsetY = dirY * scale * (this.canvas.height / 2);
    if (Math.hypot(offsetX, offsetY) <= this.radiusPx * 1.02) {
      return { x: 0, y: 0, visible: false };
    }
    return {
      x: (this.centerPx.x + offsetX) / this.dpr,
      y: (this.centerPx.y - offsetY) / this.dpr,
      visible: true,
    };
  }

  userScreenPosition(): { x: number; y: number; visible: boolean } {
    const basis = this.baseBasis;
    if (!basis || this.dpr <= 0) return { x: 0, y: 0, visible: false };
    const rows = this.effectiveRows(basis);
    const cam = {
      x: dot(this.user, rows[0]),
      y: dot(this.user, rows[1]),
      z: dot(this.user, rows[2]),
    };
    if (cam.z <= 0) return { x: 0, y: 0, visible: false };
    return {
      x: (this.centerPx.x + cam.x * this.radiusPx) / this.dpr,
      y: (this.centerPx.y - cam.y * this.radiusPx) / this.dpr,
      visible: true,
    };
  }

  userSurfaceTilt(): {
    yawDeg: number;
    pitchDeg: number;
    visible: boolean;
  } {
    const basis = this.baseBasis;
    if (!basis || this.dpr <= 0) {
      return { yawDeg: 0, pitchDeg: 0, visible: false };
    }
    const rows = this.effectiveRows(basis);
    const nx = dot(this.user, rows[0]);
    const ny = dot(this.user, rows[1]);
    const nz = dot(this.user, rows[2]);
    if (nz <= 0) return { yawDeg: 0, pitchDeg: 0, visible: false };
    return {
      yawDeg: (Math.atan2(nx, nz) * 180) / Math.PI,
      pitchDeg: (Math.atan2(ny, Math.hypot(nx, nz)) * 180) / Math.PI,
      visible: true,
    };
  }

  resetView(animate = true): void {
    if (this.resetFrame) {
      cancelAnimationFrame(this.resetFrame);
      this.resetFrame = 0;
    }
    if (!animate) {
      this.yaw = 0;
      this.pitch = 0;
      this.invalidate();
      return;
    }
    if (Math.abs(this.yaw) < 1e-4 && Math.abs(this.pitch) < 1e-4) {
      this.yaw = 0;
      this.pitch = 0;
      return;
    }
    const fromYaw = this.yaw;
    const fromPitch = this.pitch;
    const start = performance.now();
    const duration = 260;
    const step = (now: number) => {
      if (this.disposed) return;
      const t = Math.min(1, (now - start) / duration);
      const ease = 1 - Math.pow(1 - t, 3);
      this.yaw = fromYaw * (1 - ease);
      this.pitch = fromPitch * (1 - ease);
      if (document.visibilityState !== "hidden") this.draw();
      if (t < 1) {
        this.resetFrame = requestAnimationFrame(step);
      } else {
        this.resetFrame = 0;
        this.yaw = 0;
        this.pitch = 0;
        this.invalidate();
      }
    };
    this.resetFrame = requestAnimationFrame(step);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.resetFrame) cancelAnimationFrame(this.resetFrame);
    this.frame = 0;
    this.resetFrame = 0;
    document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("resize", this.handleWindowResize);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    const gl = this.gl;
    if (gl) {
      if (this.buffer) gl.deleteBuffer(this.buffer);
      if (this.program) gl.deleteProgram(this.program);
      if (this.starBuffer) gl.deleteBuffer(this.starBuffer);
      if (this.starProgram) gl.deleteProgram(this.starProgram);
      if (this.coastlineBuffer) gl.deleteBuffer(this.coastlineBuffer);
      if (this.coastlineIndexBuffer) {
        gl.deleteBuffer(this.coastlineIndexBuffer);
      }
      if (this.coastlineProgram) gl.deleteProgram(this.coastlineProgram);
      // 不调用 WEBGL_lose_context：StrictMode 会复用同一块 canvas 重新挂载，
      // 主动丢上下文会让第二次初始化拿到已丢失的上下文。
    }
    this.gl = null;
    this.program = null;
    this.buffer = null;
    this.uniforms = null;
    this.starProgram = null;
    this.starBuffer = null;
    this.starUniforms = null;
    this.starDirLocation = -1;
    this.starStyleLocation = -1;
    this.coastlineProgram = null;
    this.coastlineBuffer = null;
    this.coastlineIndexBuffer = null;
    this.coastlineUniforms = null;
    this.coastlineAA = -1;
    this.coastlineAB = -1;
    this.coastlineStyle = -1;
    this.coastlineIndexCount = 0;
    this.coastlineIndexType = 0;
    this.coastlineLoaded = false;
    this.baseBasis = null;
  }

  private initGL(): boolean {
    const gl = this.gl;
    if (!gl) return false;
    const program = createProgram(gl, VERTEX_SHADER, FRAGMENT_SHADER, "globe");
    if (!program) {
      this.onFallback?.("着色器初始化失败");
      return false;
    }
    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      this.onFallback?.("顶点缓冲创建失败");
      return false;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.useProgram(program);
    const position = gl.getAttribLocation(program, "a_position");
    if (position < 0) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      this.onFallback?.("顶点属性缺失");
      return false;
    }
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    this.positionLocation = position;

    const uniforms = {} as Record<UniformName, WebGLUniformLocation>;
    for (const name of UNIFORM_NAMES) {
      const location = gl.getUniformLocation(program, name);
      if (!location) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        console.error("[globe] missing uniform", name);
        this.onFallback?.("着色器参数缺失");
        return false;
      }
      uniforms[name] = location;
    }

    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.program = program;
    this.buffer = buffer;
    this.uniforms = uniforms;
    this.initStars(gl);
    if (ENABLE_COASTLINES) this.initCoastline(gl);
    return true;
  }

  private initStars(gl: WebGLRenderingContext): void {
    const program = createProgram(
      gl,
      STAR_VERTEX_SHADER,
      STAR_FRAGMENT_SHADER,
      "star",
    );
    if (!program) return;
    const buffer = gl.createBuffer();
    if (!buffer) {
      gl.deleteProgram(program);
      return;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.starData, gl.STATIC_DRAW);

    const dirLocation = gl.getAttribLocation(program, "a_dir");
    const styleLocation = gl.getAttribLocation(program, "a_style");
    if (dirLocation < 0 || styleLocation < 0) {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      return;
    }

    const uniforms = {} as Record<StarUniformName, WebGLUniformLocation>;
    for (const name of STAR_UNIFORM_NAMES) {
      const location = gl.getUniformLocation(program, name);
      if (!location) {
        gl.deleteBuffer(buffer);
        gl.deleteProgram(program);
        return;
      }
      uniforms[name] = location;
    }

    this.starProgram = program;
    this.starBuffer = buffer;
    this.starUniforms = uniforms;
    this.starDirLocation = dirLocation;
    this.starStyleLocation = styleLocation;
  }

  private initCoastline(gl: WebGLRenderingContext): void {
    const program = createProgram(
      gl,
      COASTLINE_VERTEX_SHADER,
      COASTLINE_FRAGMENT_SHADER,
      "coastline",
    );
    if (!program) return;
    const buffer = gl.createBuffer();
    const indexBuffer = gl.createBuffer();
    if (!buffer || !indexBuffer) {
      if (buffer) gl.deleteBuffer(buffer);
      if (indexBuffer) gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
      return;
    }
    const aa = gl.getAttribLocation(program, "a_a");
    const ab = gl.getAttribLocation(program, "a_b");
    const style = gl.getAttribLocation(program, "a_style");
    if (aa < 0 || ab < 0 || style < 0) {
      gl.deleteBuffer(buffer);
      gl.deleteBuffer(indexBuffer);
      gl.deleteProgram(program);
      return;
    }
    const uniforms = {} as Record<CoastlineUniformName, WebGLUniformLocation>;
    for (const name of COASTLINE_UNIFORM_NAMES) {
      const location = gl.getUniformLocation(program, name);
      if (!location) {
        gl.deleteBuffer(buffer);
        gl.deleteBuffer(indexBuffer);
        gl.deleteProgram(program);
        return;
      }
      uniforms[name] = location;
    }
    this.coastlineProgram = program;
    this.coastlineBuffer = buffer;
    this.coastlineIndexBuffer = indexBuffer;
    this.coastlineAA = aa;
    this.coastlineAB = ab;
    this.coastlineStyle = style;
    this.coastlineUniforms = uniforms;
    this.coastlineLoaded = false;
    this.loadCoastline();
  }

  private loadCoastline(): void {
    fetch("/globe/map.bin")
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((buffer) => {
        if (this.disposed) return;
        this.uploadCoastline(buffer);
      })
      .catch((error) => {
        console.warn("[globe] coastline", error);
      });
  }

  private uploadCoastline(buffer: ArrayBuffer): void {
    const gl = this.gl;
    if (
      !gl ||
      !this.coastlineProgram ||
      !this.coastlineBuffer ||
      !this.coastlineIndexBuffer
    ) {
      return;
    }
    try {
      if (buffer.byteLength < 16) throw new Error("short header");
      const view = new DataView(buffer);
      const magic =
        String.fromCharCode(view.getUint8(0), view.getUint8(1)) +
        String.fromCharCode(view.getUint8(2), view.getUint8(3));
      if (magic !== "GLM1") throw new Error(`bad magic ${magic}`);
      const version = view.getUint32(4, true);
      if (version !== 1) throw new Error(`unsupported version ${version}`);
      const polylineCount = view.getUint32(8, true);
      const pointCount = view.getUint32(12, true);
      if (polylineCount > 100_000 || pointCount > 500_000) {
        throw new Error("implausible header");
      }

      const DEG = Math.PI / 180;
      let offset = 16;
      const lines: Float32Array[] = [];
      let totalSegments = 0;
      for (let p = 0; p < polylineCount; p += 1) {
        if (offset + 4 > buffer.byteLength) throw new Error("truncated line");
        const count = view.getUint32(offset, true);
        offset += 4;
        if (offset + count * 8 > buffer.byteLength) {
          throw new Error("truncated points");
        }
        const points = new Float32Array(count * 3);
        for (let i = 0; i < count; i += 1) {
          const lon = view.getFloat32(offset, true);
          const lat = view.getFloat32(offset + 4, true);
          offset += 8;
          const phi = lat * DEG;
          const lambda = lon * DEG;
          const cosPhi = Math.cos(phi);
          points[i * 3] = cosPhi * Math.sin(lambda);
          points[i * 3 + 1] = Math.sin(phi);
          points[i * 3 + 2] = cosPhi * Math.cos(lambda);
        }
        if (count >= 2) {
          lines.push(points);
          totalSegments += count - 1;
        }
      }
      if (totalSegments === 0) throw new Error("no segments");

      const vertexCapacity = totalSegments * 4;
      const useUint32 = vertexCapacity > 65_535;
      if (useUint32 && !gl.getExtension("OES_element_index_uint")) {
        throw new Error("too many vertices for uint16 indices");
      }
      const vertices = new Float32Array(vertexCapacity * 8);
      const indices = useUint32
        ? new Uint32Array(totalSegments * 6)
        : new Uint16Array(totalSegments * 6);
      let vertexOffset = 0;
      let indexOffset = 0;
      for (const points of lines) {
        const count = points.length / 3;
        for (let i = 0; i + 1 < count; i += 1) {
          const a = i * 3;
          const b = (i + 1) * 3;
          if (
            points[a] === points[b] &&
            points[a + 1] === points[b + 1] &&
            points[a + 2] === points[b + 2]
          ) {
            continue;
          }
          const base = vertexOffset / 8;
          const put = (end: number, side: number) => {
            vertices[vertexOffset] = points[a];
            vertices[vertexOffset + 1] = points[a + 1];
            vertices[vertexOffset + 2] = points[a + 2];
            vertices[vertexOffset + 3] = points[b];
            vertices[vertexOffset + 4] = points[b + 1];
            vertices[vertexOffset + 5] = points[b + 2];
            vertices[vertexOffset + 6] = end;
            vertices[vertexOffset + 7] = side;
            vertexOffset += 8;
          };
          put(0, 0);
          put(0, 1);
          put(1, 0);
          put(1, 1);
          indices[indexOffset] = base;
          indices[indexOffset + 1] = base + 1;
          indices[indexOffset + 2] = base + 2;
          indices[indexOffset + 3] = base + 2;
          indices[indexOffset + 4] = base + 1;
          indices[indexOffset + 5] = base + 3;
          indexOffset += 6;
        }
      }
      if (indexOffset === 0) throw new Error("no drawable segments");

      gl.bindBuffer(gl.ARRAY_BUFFER, this.coastlineBuffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        vertices.subarray(0, vertexOffset),
        gl.STATIC_DRAW,
      );
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.coastlineIndexBuffer);
      gl.bufferData(
        gl.ELEMENT_ARRAY_BUFFER,
        indices.subarray(0, indexOffset),
        gl.STATIC_DRAW,
      );
      this.coastlineIndexCount = indexOffset;
      this.coastlineIndexType = useUint32
        ? gl.UNSIGNED_INT
        : gl.UNSIGNED_SHORT;
      this.coastlineLoaded = true;
      console.info(
        `[globe] coastline ${lines.length} lines, ${vertexOffset / 8} vertices`,
      );
      this.invalidate();
    } catch (error) {
      console.warn("[globe] coastline data", error);
    }
  }

  private effectiveRows(basis: ViewBasis): [Vec3, Vec3, Vec3] {
    if (Math.abs(this.yaw) < 1e-9 && Math.abs(this.pitch) < 1e-9) {
      return [basis.right, basis.up, basis.back];
    }
    const cy = Math.cos(this.yaw);
    const sy = Math.sin(this.yaw);
    const cx = Math.cos(this.pitch);
    const sx = Math.sin(this.pitch);
    const rows: Array<[number, number, number]> = [
      [cy, 0, sy],
      [sx * sy, cx, -sx * cy],
      [-cx * sy, sx, cx * cy],
    ];
    return rows.map(([a, b, c]) =>
      add(add(scale(basis.right, a), scale(basis.up, b)), scale(basis.back, c)),
    ) as [Vec3, Vec3, Vec3];
  }

  private draw(): void {
    const gl = this.gl;
    const uniforms = this.uniforms;
    const scene = this.scene;
    const basis = this.baseBasis;
    if (!gl || !uniforms || !scene || !basis || this.contextLost) return;
    if (this.canvas.width === 0 || this.canvas.height === 0) return;

    const rows = this.effectiveRows(basis);
    const palette = scene.palette;

    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    const starUniforms = this.starUniforms;
    if (
      this.starProgram &&
      this.starBuffer &&
      starUniforms &&
      this.starDirLocation >= 0 &&
      this.starStyleLocation >= 0
    ) {
      gl.useProgram(this.starProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.starBuffer);
      gl.enableVertexAttribArray(this.starDirLocation);
      gl.vertexAttribPointer(this.starDirLocation, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(this.starStyleLocation);
      gl.vertexAttribPointer(this.starStyleLocation, 3, gl.FLOAT, false, 24, 12);
      setVec3(gl, starUniforms.u_right, rows[0]);
      setVec3(gl, starUniforms.u_up, rows[1]);
      setVec3(gl, starUniforms.u_back, rows[2]);
      gl.uniform2f(starUniforms.u_center, this.centerPx.x, this.centerPx.y);
      gl.uniform1f(starUniforms.u_radius, this.radiusPx);
      gl.uniform2f(
        starUniforms.u_resolution,
        this.canvas.width,
        this.canvas.height,
      );
      gl.uniform2f(
        starUniforms.u_skyHalf,
        this.canvas.width / 2,
        this.canvas.height / 2,
      );
      gl.uniform1f(starUniforms.u_dpr, this.dpr);
      gl.uniform3f(starUniforms.u_tint, 1.0, 1.0, 1.0);
      gl.uniform1f(starUniforms.u_glow, 0.0);
      gl.drawArrays(gl.POINTS, 0, STAR_COUNT);

      gl.uniform3f(starUniforms.u_tint, 1.0, 0.52, 0.32);
      gl.uniform1f(starUniforms.u_glow, 1.0);
      gl.vertexAttribPointer(
        this.starDirLocation,
        3,
        gl.FLOAT,
        false,
        24,
        STAR_COUNT * 24,
      );
      gl.vertexAttribPointer(
        this.starStyleLocation,
        3,
        gl.FLOAT,
        false,
        24,
        STAR_COUNT * 24 + 12,
      );
      gl.drawArrays(gl.POINTS, 0, 1);
    }

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(this.positionLocation);
    gl.vertexAttribPointer(this.positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.uniform2f(uniforms.u_center, this.centerPx.x, this.centerPx.y);
    gl.uniform1f(uniforms.u_radius, this.radiusPx);
    gl.uniform1f(uniforms.u_dpr, this.dpr);

    setVec3(gl, uniforms.u_right, rows[0]);
    setVec3(gl, uniforms.u_up, rows[1]);
    setVec3(gl, uniforms.u_back, rows[2]);
    setVec3(gl, uniforms.u_sun, this.sun);
    setVec3(gl, uniforms.u_user, this.user);
    gl.uniform1f(uniforms.u_userLat, scene.lat);
    gl.uniform1f(uniforms.u_userLon, scene.lon);

    setColor(gl, uniforms.u_fillDay, palette.fillDay);
    setColor(gl, uniforms.u_fillNight, palette.fillNight);
    setColor(gl, uniforms.u_lineDay, palette.lineDay);
    setColor(gl, uniforms.u_lineNight, palette.lineNight);
    gl.uniform1f(uniforms.u_lineAlphaDay, palette.lineAlphaDay);
    gl.uniform1f(uniforms.u_lineAlphaNight, palette.lineAlphaNight);
    gl.uniform1f(uniforms.u_secondaryAlpha, palette.secondaryAlpha);
    setColor(gl, uniforms.u_accent, palette.accent);
    gl.uniform1f(uniforms.u_accentAlpha, palette.accentAlpha);
    setColor(gl, uniforms.u_terminator, palette.terminator);
    gl.uniform1f(uniforms.u_termStrength, this.terminatorStrength);
    gl.uniform1f(uniforms.u_twilightHalf, this.twilightHalf);
    setColor(gl, uniforms.u_rim, palette.rim);
    gl.uniform1f(uniforms.u_rimAlpha, palette.rimAlpha);
    setColor(gl, uniforms.u_marker, palette.marker);
    setColor(gl, uniforms.u_markerRing, palette.markerRing);
    gl.uniform1f(uniforms.u_sunCore, this.sunCorePx);
    gl.uniform1f(uniforms.u_sunBloom, this.sunBloomPx);
    gl.uniform1f(uniforms.u_sunIntensity, this.sunIntensity);
    gl.uniform1f(uniforms.u_sunFlare, this.sunFlare);
    gl.uniform1f(uniforms.u_sunViewFalloff, this.sunViewFalloff);
    gl.uniform2f(
      uniforms.u_skyHalf,
      this.canvas.width / 2,
      this.canvas.height / 2,
    );
    setVec3(gl, uniforms.u_moon, this.moon);
    gl.uniform1f(uniforms.u_moonSize, this.moonSizePx);
    gl.uniform1f(uniforms.u_moonDark, this.moonDark);

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    const coastlineUniforms = this.coastlineUniforms;
    if (
      this.coastlineLoaded &&
      this.coastlineProgram &&
      this.coastlineBuffer &&
      this.coastlineIndexBuffer &&
      coastlineUniforms &&
      this.coastlineIndexCount > 0 &&
      this.coastlineAA >= 0 &&
      this.coastlineAB >= 0 &&
      this.coastlineStyle >= 0
    ) {
      gl.useProgram(this.coastlineProgram);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.coastlineBuffer);
      const stride = 8 * 4;
      gl.enableVertexAttribArray(this.coastlineAA);
      gl.vertexAttribPointer(this.coastlineAA, 3, gl.FLOAT, false, stride, 0);
      gl.enableVertexAttribArray(this.coastlineAB);
      gl.vertexAttribPointer(this.coastlineAB, 3, gl.FLOAT, false, stride, 12);
      gl.enableVertexAttribArray(this.coastlineStyle);
      gl.vertexAttribPointer(this.coastlineStyle, 2, gl.FLOAT, false, stride, 24);
      setVec3(gl, coastlineUniforms.u_right, rows[0]);
      setVec3(gl, coastlineUniforms.u_up, rows[1]);
      setVec3(gl, coastlineUniforms.u_back, rows[2]);
      setVec3(gl, coastlineUniforms.u_sun, this.sun);
      gl.uniform2f(
        coastlineUniforms.u_center,
        this.centerPx.x,
        this.centerPx.y,
      );
      gl.uniform1f(coastlineUniforms.u_radius, this.radiusPx);
      gl.uniform2f(
        coastlineUniforms.u_resolution,
        this.canvas.width,
        this.canvas.height,
      );
      gl.uniform1f(coastlineUniforms.u_dpr, this.dpr);
      gl.uniform1f(coastlineUniforms.u_lineWidth, COASTLINE_LINE_WIDTH);
      gl.uniform1f(coastlineUniforms.u_twilightHalf, this.twilightHalf);
      setColor(gl, coastlineUniforms.u_lineDay, palette.lineDay);
      setColor(gl, coastlineUniforms.u_lineNight, palette.lineNight);
      gl.uniform1f(
        coastlineUniforms.u_coastAlphaDay,
        COASTLINE_ALPHA_DAY,
      );
      gl.uniform1f(
        coastlineUniforms.u_coastAlphaNight,
        COASTLINE_ALPHA_NIGHT,
      );
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.coastlineIndexBuffer);
      gl.drawElements(
        gl.TRIANGLES,
        this.coastlineIndexCount,
        this.coastlineIndexType,
        0,
      );
    }
  }

  private invalidate(): void {
    if (this.disposed || this.contextLost) return;
    this.dirty = true;
    if (document.visibilityState === "hidden") return;
    if (!this.frame) this.frame = requestAnimationFrame(this.flush);
  }

  private flush = (): void => {
    this.frame = 0;
    if (!this.dirty) return;
    this.dirty = false;
    this.draw();
  };

  private handleVisibility = (): void => {
    if (document.visibilityState === "hidden") {
      if (this.frame) cancelAnimationFrame(this.frame);
      this.frame = 0;
      return;
    }
    if (this.dirty) this.invalidate();
  };

  private handleWindowResize = (): void => {
    this.resize(this.canvas.clientWidth, this.canvas.clientHeight);
  };

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    if (this.frame) cancelAnimationFrame(this.frame);
    if (this.resetFrame) cancelAnimationFrame(this.resetFrame);
    this.frame = 0;
    this.resetFrame = 0;
    this.onFallback?.("WebGL 上下文丢失");
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    if (this.initGL()) this.invalidate();
  };
}

function setVec3(
  gl: WebGLRenderingContext,
  location: WebGLUniformLocation,
  value: Vec3,
): void {
  gl.uniform3f(location, value.x, value.y, value.z);
}

function setColor(
  gl: WebGLRenderingContext,
  location: WebGLUniformLocation,
  value: Rgb,
): void {
  gl.uniform3f(location, value[0], value[1], value[2]);
}
