export const VERTEX_SHADER = `
attribute vec2 aPos;
varying vec2 vUv;
void main() {
  vUv = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

const NOISE = `
float hash21(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  float a = hash21(i);
  float b = hash21(i + vec2(1.0, 0.0));
  float c = hash21(i + vec2(0.0, 1.0));
  float d = hash21(i + vec2(1.0, 1.0));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}

float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 2; i++) {
    v += a * vnoise(p);
    p = p * 2.03 + vec2(17.3, 9.1);
    a *= 0.5;
  }
  return v;
}
`;

export const SCENE_SHADER = `
precision highp float;
varying vec2 vUv;

uniform vec2 uCssRes;
uniform float uTime;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uLightA;
uniform vec3 uLightB;
uniform vec3 uCaustic;
uniform float uCausticAmt;
uniform vec3 uCausticShade;
uniform float uCausticShadeAmt;
uniform float uCausticGain;
uniform float uFlowSpeed;
uniform float uWarp;
uniform float uScale;
uniform float uGrain;
uniform float uCalm;
uniform vec3 uCalmColor;
uniform float uLightGain;
uniform float uViscosity;
uniform vec2 uLensCenter;
uniform vec2 uLensRadii;
uniform vec2 uPointer;
uniform float uPress;
uniform vec2 uPigmentA;
uniform vec2 uPigmentB;
uniform vec3 uHairA;
uniform vec3 uHairB;
uniform float uPigmentStrength;
uniform float uActiveRow;

${NOISE}

void main() {
  vec2 uv = vUv;
  vec2 p = (uv - 0.5) * vec2(6.26, 4.28) * uScale;
  float t = uTime * uFlowSpeed * uViscosity;

  vec2 q = vec2(
    fbm(p + vec2(0.0, t)),
    fbm(p + vec2(5.2, 1.3) - vec2(t * 0.7, 0.0))
  );
  vec2 r = vec2(
    fbm(p + 2.0 * q + vec2(1.7, 9.2) + vec2(t * 0.35, 0.0)),
    fbm(p + 2.0 * q + vec2(8.3, 2.8) - vec2(t * 0.25, 0.0))
  );
  float n = fbm(p + 1.8 * r * uWarp);
  float m = fbm(p * 0.55 + vec2(3.1, 7.7) - vec2(t * 0.25, 0.0));
  float m2 = fbm(p * 0.75 + vec2(9.1, 21.7) + vec2(0.0, t * 0.15));
  float ribbon = smoothstep(0.42, 0.82, n);

  float vertical = smoothstep(0.0, 1.0, uv.y);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.1, 0.9, n * 0.45 + m * 0.35 + m2 * 0.2));
  float slow = 0.5 + 0.5 * sin(p.x * 0.8 + p.y * 0.5 - t * 0.4);
  col = mix(col, uColorB, slow * 0.25);
  col *= 0.94 + 0.12 * (1.0 - vertical);

  vec3 head = max(vec3(0.0), 1.0 - col);

  vec2 lpos1 = vec2(0.16 + 0.05 * sin(t * 0.6), 0.18 + 0.07 * cos(t * 0.4));
  vec2 lpos2 = vec2(0.86 + 0.04 * cos(t * 0.35), 0.8 + 0.05 * sin(t * 0.45));
  float l1 = exp(-dot(uv - lpos1, uv - lpos1) * 9.0);
  float l2 = exp(-dot(uv - lpos2, uv - lpos2) * 7.0);
  float band = exp(-pow((uv.x * 0.8 + uv.y * 0.55 - 0.55 - 0.12 * sin(t * 0.25)) / 0.32, 2.0));
  float topGlow = exp(-dot(uv - vec2(0.5, 0.02), uv - vec2(0.5, 0.02)) * 3.2);
  vec3 lightSum = uLightA * (l1 * 0.2 + band * 0.1) + uLightB * (l2 * 0.14 + topGlow * 0.2);
  col += lightSum * head * uLightGain * 1.6;

  col += uLightA * ribbon * head * uLightGain * 0.2;
  col += uLightA * smoothstep(0.55, 0.85, n) * head * uLightGain * 0.18;

  float pa = exp(-dot(uv - uPigmentA, uv - uPigmentA) * 15.0);
  float pb = exp(-dot(uv - uPigmentB, uv - uPigmentB) * 15.0);
  float activeA = abs(uActiveRow - 1.0) < 0.5 ? 1.0 : 0.58;
  float activeB = abs(uActiveRow - 2.0) < 0.5 ? 1.0 : 0.58;
  col = mix(col, uHairA, pa * uPigmentStrength * activeA);
  col = mix(col, uHairB, pb * uPigmentStrength * activeB);

  col = mix(col, uCalmColor, uCalm);

  float grain = hash21(gl_FragCoord.xy + vec2(uTime * 41.0, uTime * 13.0)) - 0.5;
  col += grain * uGrain * 0.3;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;

export const COMPOSITE_SHADER = `
precision highp float;
varying vec2 vUv;

uniform sampler2D uScene;
uniform vec2 uRes;
uniform float uTime;
uniform float uDpr;
uniform float uEdgeBand;
uniform float uRefract;
uniform float uDispersion;
uniform float uVeilAlpha;
uniform vec3 uVeilColor;
uniform vec3 uTint;
uniform vec3 uRimColor;
uniform vec3 uSpecColor;
uniform float uAbsorb;
uniform float uSpecAmt;
uniform float uSpecPow;
uniform float uRimAmt;
uniform float uGrain;
uniform vec2 uPointer;
uniform float uPress;
uniform vec2 uLensCenter;
uniform vec2 uLensRadii;
uniform float uLensPower;
uniform float uLensDisp;
uniform float uBevelPx;
uniform float uBevelAmt;
uniform vec3 uCaustic;
uniform float uCausticAmt;
uniform vec3 uCausticShade;
uniform float uCausticShadeAmt;
uniform float uCausticGain;
uniform vec2 uChangeOrigin;
uniform float uChangeProgress;

${NOISE}

void main() {
  vec2 uv = vUv;
  vec2 p = uv * uRes;

  float dpx = min(min(p.x, uRes.x - p.x), min(p.y, uRes.y - p.y));
  float band = max(uEdgeBand * uDpr, 0.75);
  float edgeW = 1.0 - smoothstep(0.0, band * 2.4, dpx);

  vec2 d = uv - uLensCenter;
  vec2 e = d / uLensRadii;
  float s = length(e);
  s *= 1.0 + 0.035 * sin(atan(e.y, e.x) * 3.0 + uTime * 0.18);
  float soft = 1.0 - smoothstep(0.72, 1.02, s);
  float meniscus = max(1.0 - s * s, 0.0);
  float k = uLensPower * soft * (0.65 + 0.35 * meniscus);
  vec2 lensUv = uv - d * k;

  vec2 texel = 1.0 / uRes;
  float h = texture2D(uScene, uv).r;
  float hx = texture2D(uScene, uv + vec2(texel.x * 2.0, 0.0)).r;
  float hy = texture2D(uScene, uv + vec2(0.0, texel.y * 2.0)).r;
  vec2 flowN = normalize(vec2(hx - h, hy - h) + vec2(1e-5));
  vec2 inward = normalize(vec2(uRes.x * 0.5, uRes.y * 0.5) - p + vec2(1e-5));
  vec2 off = (inward * 0.85 + flowN * 0.32) * (uRefract * uDpr) * edgeW / uRes;
  vec2 baseUv = lensUv + off * (1.0 - 0.6 * soft);

  vec2 blur = texel * (0.3 + uEdgeBand * 0.22) * (1.0 - 0.45 * soft);
  vec3 s0 = texture2D(uScene, baseUv).rgb;
  vec3 s1 = texture2D(uScene, baseUv + vec2(blur.x, 0.0)).rgb;
  vec3 s2 = texture2D(uScene, baseUv - vec2(blur.x, 0.0)).rgb;
  vec3 s3 = texture2D(uScene, baseUv + vec2(0.0, blur.y)).rgb;
  vec3 s4 = texture2D(uScene, baseUv - vec2(0.0, blur.y)).rgb;
  vec3 s5 = texture2D(uScene, baseUv + blur).rgb;
  vec3 s6 = texture2D(uScene, baseUv - blur).rgb;
  vec3 s7 = texture2D(uScene, baseUv + vec2(blur.x, -blur.y)).rgb;
  vec3 s8 = texture2D(uScene, baseUv + vec2(-blur.x, blur.y)).rgb;
  vec3 col = s0 * 0.28
    + (s1 + s2 + s3 + s4) * 0.12
    + (s5 + s6 + s7 + s8) * 0.06;

  vec2 radialDir = normalize(d + vec2(1e-5));
  vec2 ldisp = radialDir * uLensDisp * soft;
  if (uLensDisp > 0.0 && soft > 0.0) {
    col.r = mix(col.r, texture2D(uScene, baseUv + ldisp).r, 0.55 * soft);
    col.b = mix(col.b, texture2D(uScene, baseUv - ldisp).b, 0.55 * soft);
  }

  float depth = 0.18 + edgeW * 0.42;
  col = mix(col, uTint, uAbsorb * depth);

  float center = smoothstep(0.0, 0.62, 1.0 - edgeW);
  vec3 veil = mix(uVeilColor, s0, 0.05);
  col = mix(col, veil, uVeilAlpha * center * (1.0 - 0.8 * soft));

  vec2 cuv = lensUv;
  float tc = uTime * 0.12;
  float cw1 = fbm(cuv * 3.0 + vec2(tc * 0.5, 0.0));
  float cw2 = fbm(cuv * 5.0 + vec2(4.2, 1.7) - vec2(tc * 0.3, 0.0));
  float crf = clamp(fbm(cuv * 4.0 + cw1 * 1.8 + cw2 * 0.7 + vec2(tc * 0.15, -tc * 0.1)) / 0.72, 0.0, 1.0);
  float cridge = pow(1.0 - abs(2.0 * crf - 1.0), 7.0);
  float cline = pow(0.5 + 0.5 * sin(cuv.x * 12.0 + cuv.y * 6.0 + cw2 * 5.0 + tc * 1.2), 8.0);
  float cline2 = pow(0.5 + 0.5 * sin(cuv.x * 8.0 - cuv.y * 3.6 + cw1 * 4.5 - tc * 0.9), 10.0) * 0.35;
  float cpatch = smoothstep(0.25, 0.65, fbm(cuv * 3.1 + vec2(9.2, 4.1)));
  float ca = clamp(max(cridge, max(cline, cline2) * 0.55) * (0.35 + 0.65 * cpatch)
    * (0.4 + 0.6 * soft) * uCausticAmt, 0.0, 1.0);
  col = mix(col, uCausticShade, ca * uCausticShadeAmt);
  col += uCaustic * ca * ca * uCausticGain;

  float bevelPx = max(uBevelPx, 1.0);
  float wallT = clamp(dpx / bevelPx, 0.0, 1.0);
  float wall = pow(1.0 - wallT, 1.7);
  float asym = 0.86 + 0.14 * (1.0 - uv.y);
  col = mix(col, uTint * 0.55, uBevelAmt * wall * asym);
  float lip = 1.0 - smoothstep(0.0, max(band * 0.28, 1.0), dpx);
  col *= 1.0 - uBevelAmt * 0.45 * lip * lip;

  float grain = hash21(gl_FragCoord.xy + vec2(uTime * 37.0, uTime * 11.0)) - 0.5;
  col += grain * uGrain;

  gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
}
`;
