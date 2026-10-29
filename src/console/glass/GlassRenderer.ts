import {
  THICKNESSES,
  THEMES,
  thicknessByLevel,
  type Rgb,
  type ThemeConfig,
  type ThemeId,
  type ThicknessConfig,
  type ThicknessLevel,
} from "./config";
import { COMPOSITE_SHADER, SCENE_SHADER, VERTEX_SHADER } from "./shaders";

type Vec2 = { x: number; y: number };

type Material = {
  colorA: Rgb;
  colorB: Rgb;
  lightA: Rgb;
  lightB: Rgb;
  caustic: Rgb;
  tint: Rgb;
  veil: Rgb;
  rim: Rgb;
  spec: Rgb;
  flowSpeed: number;
  warp: number;
  scale: number;
  grain: number;
  calm: number;
  lightGain: number;
  absorb: number;
  specAmt: number;
  specPow: number;
  rimAmt: number;
  causticShade: Rgb;
  causticShadeAmt: number;
  causticGain: number;
  bevelScale: number;
};

const SCENE_UNIFORMS = [
  "uCssRes", "uTime", "uColorA", "uColorB", "uLightA", "uLightB",
  "uCaustic", "uCausticAmt", "uCausticShade", "uCausticShadeAmt", "uCausticGain",
  "uFlowSpeed", "uWarp", "uScale", "uGrain", "uCalm", "uCalmColor", "uLightGain", "uViscosity", "uPointer",
  "uLensCenter", "uLensRadii",
  "uPress", "uPigmentA", "uPigmentB", "uHairA", "uHairB",
  "uPigmentStrength", "uActiveRow",
];

const COMPOSITE_UNIFORMS = [
  "uScene", "uRes", "uTime", "uDpr", "uEdgeBand", "uRefract",
  "uDispersion", "uVeilAlpha", "uVeilColor", "uTint", "uRimColor",
  "uSpecColor", "uAbsorb", "uSpecAmt", "uSpecPow", "uRimAmt",
  "uGrain", "uPointer", "uPress", "uLensCenter", "uLensRadii",
  "uLensPower", "uLensDisp", "uBevelPx", "uBevelAmt",
  "uCaustic", "uCausticAmt", "uCausticShade", "uCausticShadeAmt", "uCausticGain",
];

const damp = (current: number, target: number, lambda: number, dt: number) =>
  current + (target - current) * (1 - Math.exp(-lambda * dt));

function dampRgb(current: Rgb, target: Rgb, lambda: number, dt: number): Rgb {
  return [
    damp(current[0], target[0], lambda, dt),
    damp(current[1], target[1], lambda, dt),
    damp(current[2], target[2], lambda, dt),
  ];
}

function cloneRgb(value: Rgb): Rgb {
  return [value[0], value[1], value[2]];
}

function materialFromTheme(theme: ThemeConfig): Material {
  return {
    colorA: cloneRgb(theme.scene.colorA),
    colorB: cloneRgb(theme.scene.colorB),
    lightA: cloneRgb(theme.scene.lightA),
    lightB: cloneRgb(theme.scene.lightB),
    caustic: cloneRgb(theme.scene.caustic),
    tint: cloneRgb(theme.glass.tint),
    veil: cloneRgb(theme.glass.veil),
    rim: cloneRgb(theme.glass.rim),
    spec: cloneRgb(theme.glass.spec),
    flowSpeed: theme.scene.flowSpeed,
    warp: theme.scene.warp,
    scale: theme.scene.scale,
    grain: theme.scene.grain,
    calm: theme.scene.calm,
    lightGain: theme.scene.lightGain,
    absorb: theme.glass.absorb,
    specAmt: theme.glass.specAmt,
    specPow: theme.glass.specPow,
    rimAmt: theme.glass.rimAmt,
    causticShade: cloneRgb(theme.scene.causticShade),
    causticShadeAmt: theme.scene.causticShadeAmt,
    causticGain: theme.scene.causticGain,
    bevelScale: theme.glass.bevelScale,
  };
}

function targetMaterial(theme: ThemeConfig): Material {
  return materialFromTheme(theme);
}

function blendMaterial(current: Material, target: Material, dt: number): void {
  const c = 6.5;
  current.colorA = dampRgb(current.colorA, target.colorA, c, dt);
  current.colorB = dampRgb(current.colorB, target.colorB, c, dt);
  current.lightA = dampRgb(current.lightA, target.lightA, c, dt);
  current.lightB = dampRgb(current.lightB, target.lightB, c, dt);
  current.caustic = dampRgb(current.caustic, target.caustic, c, dt);
  current.tint = dampRgb(current.tint, target.tint, c, dt);
  current.veil = dampRgb(current.veil, target.veil, c, dt);
  current.rim = dampRgb(current.rim, target.rim, c, dt);
  current.spec = dampRgb(current.spec, target.spec, c, dt);
  current.flowSpeed = damp(current.flowSpeed, target.flowSpeed, c, dt);
  current.warp = damp(current.warp, target.warp, c, dt);
  current.scale = damp(current.scale, target.scale, c, dt);
  current.grain = damp(current.grain, target.grain, c, dt);
  current.calm = damp(current.calm, target.calm, c, dt);
  current.lightGain = damp(current.lightGain, target.lightGain, c, dt);
  current.absorb = damp(current.absorb, target.absorb, c, dt);
  current.specAmt = damp(current.specAmt, target.specAmt, c, dt);
  current.specPow = damp(current.specPow, target.specPow, c, dt);
  current.rimAmt = damp(current.rimAmt, target.rimAmt, c, dt);
  current.causticShade = dampRgb(current.causticShade, target.causticShade, c, dt);
  current.causticShadeAmt = damp(current.causticShadeAmt, target.causticShadeAmt, c, dt);
  current.causticGain = damp(current.causticGain, target.causticGain, c, dt);
  current.bevelScale = damp(current.bevelScale, target.bevelScale, c, dt);
}

function compileShader(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log ?? "unknown"}`);
  }
  return shader;
}

function createProgram(gl: WebGLRenderingContext, fragmentSource: string): WebGLProgram {
  const vertex = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create program");
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.bindAttribLocation(program, 0, "aPos");
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log ?? "unknown"}`);
  }
  return program;
}

export type GlassRendererOptions = {
  onFallback: () => void;
};

export class GlassRenderer {
  private canvas: HTMLCanvasElement;
  private gl: WebGLRenderingContext;
  private onFallback: () => void;
  private sceneProgram: WebGLProgram | null = null;
  private compositeProgram: WebGLProgram | null = null;
  private sceneUniforms = new Map<string, WebGLUniformLocation | null>();
  private compositeUniforms = new Map<string, WebGLUniformLocation | null>();
  private buffer: WebGLBuffer | null = null;
  private sceneTexture: WebGLTexture | null = null;
  private sceneFramebuffer: WebGLFramebuffer | null = null;

  private cssW = 320;
  private cssH = 900;
  private effectiveDpr = 1;
  private fboW = 1;
  private fboH = 1;
  private qualityTier = 0;
  private frameTimes: number[] = [];
  private lastFrame = 0;

  private themeTarget: ThemeConfig;
  private thicknessTarget: ThicknessConfig;
  private material: Material;
  private materialTarget: Material;
  private edgeBand = 5;
  private refract = 8;
  private dispersion = 1.1;
  private veilAlpha = 0.64;
  private viscosity = 1;
  private viscosityTarget = 1;
  private lensCenter: Vec2 = { x: 0.5, y: 0.52 };
  private lensRadii: Vec2 = { x: 0.38, y: 0.165 };
  private lensPower = 0.17;
  private lensPowerTarget = 0.17;
  private causticAmt = 1;
  private causticAmtTarget = 1;
  private bevel = 0.12;
  private bevelTarget = 0.12;
  private lensDisp = 0.002;
  private lensDispTarget = 0.002;

  private pigmentA: Vec2 = { x: 0.22, y: 0.34 };
  private pigmentB: Vec2 = { x: 0.78, y: 0.66 };
  private pigmentTargetA: Vec2 = { x: 0.22, y: 0.34 };
  private pigmentTargetB: Vec2 = { x: 0.78, y: 0.66 };
  private activeRow = 0;
  private gears: [number, number] = [1, 1];
  private time = 0;
  private waveProgress = 1;
  private waveStart = 0;
  private waveOrigin: Vec2 = { x: 0.5, y: 0.5 };

  private raf = 0;
  private staticRaf = 0;
  private reducedMotion = false;
  private destroyed = false;
  private running = false;
  private contextLost = false;
  private lastWidth = 0;
  private lastHeight = 0;

  constructor(canvas: HTMLCanvasElement, options: GlassRendererOptions) {
    this.canvas = canvas;
    this.onFallback = options.onFallback;
    const gl = canvas.getContext("webgl", {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: false,
      powerPreference: "high-performance",
    });
    if (!gl) throw new Error("WebGL is unavailable");
    this.gl = gl;
    this.themeTarget = THEMES.white;
    this.thicknessTarget = THICKNESSES[2];
    this.material = materialFromTheme(this.themeTarget);
    this.materialTarget = targetMaterial(this.themeTarget);
    this.edgeBand = this.thicknessTarget.edgeBand;
    this.refract = this.thicknessTarget.refract;
    this.dispersion = this.thicknessTarget.dispersion;
    this.veilAlpha = this.thicknessTarget.veil[this.themeTarget.id];

    this.canvas.addEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.addEventListener("webglcontextrestored", this.handleContextRestored);
    this.initGL();
  }

  private handleContextLost = (event: Event): void => {
    event.preventDefault();
    this.contextLost = true;
    this.stop();
  };

  private handleContextRestored = (): void => {
    this.contextLost = false;
    try {
      this.initGL();
      if (!this.reducedMotion) this.start();
      else this.scheduleStaticRender();
    } catch (err) {
      console.error("[glass] context restore", err);
      this.onFallback();
    }
  };

  private initGL(): void {
    const gl = this.gl;
    this.sceneProgram = createProgram(gl, SCENE_SHADER);
    this.compositeProgram = createProgram(gl, COMPOSITE_SHADER);
    this.sceneUniforms.clear();
    this.compositeUniforms.clear();
    for (const name of SCENE_UNIFORMS) {
      this.sceneUniforms.set(name, gl.getUniformLocation(this.sceneProgram, name));
    }
    for (const name of COMPOSITE_UNIFORMS) {
      this.compositeUniforms.set(name, gl.getUniformLocation(this.compositeProgram, name));
    }

    if (!this.buffer) {
      this.buffer = gl.createBuffer();
      if (!this.buffer) throw new Error("Unable to create vertex buffer");
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
        gl.STATIC_DRAW,
      );
    }

    this.createSceneTarget(this.fboW, this.fboH);
  }

  private createSceneTarget(width: number, height: number): void {
    const gl = this.gl;
    const safeW = Math.max(1, Math.round(width));
    const safeH = Math.max(1, Math.round(height));
    if (this.sceneTexture) gl.deleteTexture(this.sceneTexture);
    if (this.sceneFramebuffer) gl.deleteFramebuffer(this.sceneFramebuffer);

    const texture = gl.createTexture();
    if (!texture) throw new Error("Unable to create scene texture");
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, safeW, safeH, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) throw new Error("Unable to create scene framebuffer");
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      throw new Error(`Scene framebuffer incomplete: ${status}`);
    }

    this.sceneTexture = texture;
    this.sceneFramebuffer = framebuffer;
    this.fboW = safeW;
    this.fboH = safeH;
  }

  resize(cssWidth: number, cssHeight: number): void {
    if (this.destroyed || this.contextLost) return;
    const width = Math.max(1, Math.round(cssWidth));
    const height = Math.max(1, Math.round(cssHeight));
    if (width === this.lastWidth && height === this.lastHeight && this.qualityTier === this.lastTier) return;
    this.lastWidth = width;
    this.lastHeight = height;
    this.lastTier = this.qualityTier;
    this.cssW = width;
    this.cssH = height;

    const dprCap = Math.min(window.devicePixelRatio || 1, 2);
    const budget = 1_300_000;
    const quality = [1, 0.85, 0.72][this.qualityTier] ?? 0.72;
    let dpr = dprCap;
    const pixels = width * height * dpr * dpr;
    if (pixels > budget) dpr *= Math.sqrt(budget / pixels);
    this.effectiveDpr = Math.max(0.5, dpr * quality);

    this.canvas.width = Math.max(1, Math.round(width * this.effectiveDpr));
    this.canvas.height = Math.max(1, Math.round(height * this.effectiveDpr));
    this.createSceneTarget(this.canvas.width * 0.62, this.canvas.height * 0.62);
    if (this.running) {
      // 重建后立即补画一帧，避免清空缓冲在合成器里露出一帧黑/透明。
      this.draw();
    } else if (this.reducedMotion) {
      this.scheduleStaticRender();
    }
  }

  private lastTier = 0;

  initialize(
    theme: ThemeId,
    level: ThicknessLevel,
    gears: [number, number],
    activeRow: 0 | 1 | 2,
  ): void {
    this.themeTarget = THEMES[theme];
    this.materialTarget = targetMaterial(this.themeTarget);
    this.material = materialFromTheme(this.themeTarget);
    this.thicknessTarget = thicknessByLevel(level);
    this.edgeBand = this.thicknessTarget.edgeBand;
    this.refract = this.thicknessTarget.refract;
    this.dispersion = this.thicknessTarget.dispersion;
    this.veilAlpha = this.thicknessTarget.veil[this.themeTarget.id];
    const baseX0 = 0.5 + 0.025 * Math.sin(1.3);
    const baseY0 = 0.52 + 0.13 * Math.sin(0.6) + 0.02;
    this.lensCenter = { x: baseX0, y: baseY0 };
    this.lensRadii = { x: 0.38, y: 0.173 };
    this.lensPower = this.thicknessTarget.lens;
    this.lensPowerTarget = this.thicknessTarget.lens;
    this.causticAmt = this.thicknessTarget.caustic;
    this.causticAmtTarget = this.thicknessTarget.caustic;
    this.bevel = this.thicknessTarget.bevel;
    this.bevelTarget = this.thicknessTarget.bevel;
    this.lensDisp = this.thicknessTarget.lensDisp;
    this.lensDispTarget = this.thicknessTarget.lensDisp;
    this.viscosity = this.thicknessTarget.viscosity;
    this.viscosityTarget = this.thicknessTarget.viscosity;
    this.gears = [
      Math.max(0, Math.min(2, gears[0])),
      Math.max(0, Math.min(2, gears[1])),
    ];
    this.pigmentA = { x: 0.22 + (this.gears[0] / 2) * 0.56, y: 0.34 };
    this.pigmentB = { x: 0.22 + (this.gears[1] / 2) * 0.56, y: 0.66 };
    this.pigmentTargetA = { ...this.pigmentA };
    this.pigmentTargetB = { ...this.pigmentB };
    this.activeRow = activeRow;
    this.waveProgress = 1;
  }

  setTheme(theme: ThemeId): void {
    if (this.themeTarget.id === theme) return;
    this.themeTarget = THEMES[theme];
    this.materialTarget = targetMaterial(this.themeTarget);
    this.triggerWave();
    if (this.reducedMotion) this.scheduleStaticRender();
  }

  setThickness(level: ThicknessLevel): void {
    if (this.thicknessTarget.level === level) return;
    this.thicknessTarget = thicknessByLevel(level);
    this.lensPowerTarget = this.thicknessTarget.lens;
    this.causticAmtTarget = this.thicknessTarget.caustic;
    this.bevelTarget = this.thicknessTarget.bevel;
    this.lensDispTarget = this.thicknessTarget.lensDisp;
    this.viscosityTarget = this.thicknessTarget.viscosity;
    this.triggerWave();
    if (this.reducedMotion) this.scheduleStaticRender();
  }

  setGears(first: number, second: number): void {
    this.gears = [Math.max(0, Math.min(2, first)), Math.max(0, Math.min(2, second))];
    this.pigmentTargetA = { x: 0.22 + (this.gears[0] / 2) * 0.56, y: 0.34 };
    this.pigmentTargetB = { x: 0.22 + (this.gears[1] / 2) * 0.56, y: 0.66 };
    if (this.reducedMotion) this.scheduleStaticRender();
  }

  setActiveRow(row: 0 | 1 | 2): void {
    this.activeRow = row;
    if (this.reducedMotion) this.scheduleStaticRender();
  }

  setReducedMotion(reduced: boolean): void {
    if (this.reducedMotion === reduced) return;
    this.reducedMotion = reduced;
    if (reduced) {
      this.stop();
      this.scheduleStaticRender();
    } else {
      this.start();
    }
  }

  private triggerWave(): void {
    this.waveStart = performance.now();
    this.waveProgress = 0;
    this.waveOrigin = {
      x: 0.5 * this.cssW * this.effectiveDpr,
      y: 0.5 * this.cssH * this.effectiveDpr,
    };
  }

  private update(dt: number): void {
    blendMaterial(this.material, this.materialTarget, dt);
    const t = this.thicknessTarget;
    this.edgeBand = damp(this.edgeBand, t.edgeBand, 10, dt);
    this.refract = damp(this.refract, t.refract, 10, dt);
    this.dispersion = damp(this.dispersion, t.dispersion, 10, dt);
    this.veilAlpha = damp(this.veilAlpha, t.veil[this.themeTarget.id], 10, dt);
    this.viscosity = damp(this.viscosity, this.viscosityTarget, 8, dt);
    this.causticAmt = damp(this.causticAmt, this.causticAmtTarget, 8, dt);
    this.bevel = damp(this.bevel, this.bevelTarget, 8, dt);
    this.lensDisp = damp(this.lensDisp, this.lensDispTarget, 8, dt);

    const lt = this.time;
    const baseX = 0.5 + 0.085 * Math.sin(0.13 * lt) + 0.025 * Math.sin(0.31 * lt + 1.3);
    const baseY = 0.52 + 0.13 * Math.sin(0.087 * lt + 0.6) + 0.02 * Math.cos(0.23 * lt);
    this.lensCenter.x = damp(this.lensCenter.x, baseX, 0.8, dt);
    this.lensCenter.y = damp(this.lensCenter.y, baseY, 0.8, dt);
    this.lensRadii.x = 0.38 + 0.012 * Math.sin(0.11 * lt);
    this.lensRadii.y = 0.165 + 0.008 * Math.cos(0.083 * lt);
    this.lensPowerTarget = this.thicknessTarget.lens;
    this.lensPower = damp(this.lensPower, this.lensPowerTarget, 6, dt);

    this.pigmentA.x = damp(this.pigmentA.x, this.pigmentTargetA.x, 2.6, dt);
    this.pigmentA.y = damp(this.pigmentA.y, this.pigmentTargetA.y, 2.6, dt);
    this.pigmentB.x = damp(this.pigmentB.x, this.pigmentTargetB.x, 2.6, dt);
    this.pigmentB.y = damp(this.pigmentB.y, this.pigmentTargetB.y, 2.6, dt);

    if (this.waveProgress < 1) {
      this.waveProgress = Math.min(1, (performance.now() - this.waveStart) / 450);
    }
  }

  private draw(): void {
    if (this.contextLost || !this.sceneProgram || !this.compositeProgram || !this.sceneFramebuffer) return;
    const gl = this.gl;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.sceneFramebuffer);
    gl.viewport(0, 0, this.fboW, this.fboH);
    gl.useProgram(this.sceneProgram);
    this.bindQuad();
    this.setSceneUniforms();
    gl.drawArrays(gl.TRIANGLES, 0, 6);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.compositeProgram);
    this.bindQuad();
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.sceneTexture);
    gl.uniform1i(this.compositeUniforms.get("uScene") ?? null, 0);
    this.setCompositeUniforms();
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }

  private bindQuad(): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  }

  private setSceneUniforms(): void {
    const gl = this.gl;
    const m = this.material;
    const u = (name: string) => this.sceneUniforms.get(name) ?? null;
    gl.uniform2f(u("uCssRes"), this.cssW, this.cssH);
    gl.uniform1f(u("uTime"), this.time);
    gl.uniform3f(u("uColorA"), m.colorA[0], m.colorA[1], m.colorA[2]);
    gl.uniform3f(u("uColorB"), m.colorB[0], m.colorB[1], m.colorB[2]);
    gl.uniform3f(u("uLightA"), m.lightA[0], m.lightA[1], m.lightA[2]);
    gl.uniform3f(u("uLightB"), m.lightB[0], m.lightB[1], m.lightB[2]);
    gl.uniform3f(u("uCaustic"), m.caustic[0], m.caustic[1], m.caustic[2]);
    gl.uniform1f(u("uCausticAmt"), this.causticAmt);
    gl.uniform3f(u("uCausticShade"), m.causticShade[0], m.causticShade[1], m.causticShade[2]);
    gl.uniform1f(u("uCausticShadeAmt"), m.causticShadeAmt);
    gl.uniform1f(u("uCausticGain"), m.causticGain);
    gl.uniform2f(u("uLensCenter"), this.lensCenter.x, this.lensCenter.y);
    gl.uniform2f(u("uLensRadii"), this.lensRadii.x, this.lensRadii.y);
    gl.uniform1f(u("uFlowSpeed"), m.flowSpeed);
    gl.uniform1f(u("uWarp"), m.warp);
    gl.uniform1f(u("uScale"), m.scale);
    gl.uniform1f(u("uGrain"), m.grain);
    gl.uniform1f(u("uCalm"), m.calm);
    gl.uniform3f(u("uCalmColor"), m.veil[0], m.veil[1], m.veil[2]);
    gl.uniform1f(u("uLightGain"), m.lightGain);
    gl.uniform1f(u("uViscosity"), this.viscosity);
    gl.uniform2f(u("uPointer"), 0.0, 0.0);
    gl.uniform1f(u("uPress"), 0.0);
    gl.uniform2f(u("uPigmentA"), this.pigmentA.x, this.pigmentA.y);
    gl.uniform2f(u("uPigmentB"), this.pigmentB.x, this.pigmentB.y);
    const a = CHARACTER_A_PIGMENT;
    const b = CHARACTER_B_PIGMENT;
    gl.uniform3f(u("uHairA"), a[0], a[1], a[2]);
    gl.uniform3f(u("uHairB"), b[0], b[1], b[2]);
    gl.uniform1f(u("uPigmentStrength"), 0);
    gl.uniform1f(u("uActiveRow"), this.activeRow);
  }

  private setCompositeUniforms(): void {
    const gl = this.gl;
    const m = this.material;
    const u = (name: string) => this.compositeUniforms.get(name) ?? null;
    gl.uniform2f(u("uRes"), this.canvas.width, this.canvas.height);
    gl.uniform1f(u("uTime"), this.time);
    gl.uniform1f(u("uDpr"), this.effectiveDpr);
    gl.uniform1f(u("uEdgeBand"), this.edgeBand);
    gl.uniform1f(u("uRefract"), this.refract);
    gl.uniform1f(u("uDispersion"), this.dispersion);
    gl.uniform1f(u("uVeilAlpha"), this.veilAlpha);
    gl.uniform3f(u("uVeilColor"), m.veil[0], m.veil[1], m.veil[2]);
    gl.uniform3f(u("uTint"), m.tint[0], m.tint[1], m.tint[2]);
    gl.uniform3f(u("uRimColor"), m.rim[0], m.rim[1], m.rim[2]);
    gl.uniform3f(u("uSpecColor"), m.spec[0], m.spec[1], m.spec[2]);
    gl.uniform1f(u("uAbsorb"), m.absorb);
    gl.uniform1f(u("uSpecAmt"), m.specAmt);
    gl.uniform1f(u("uSpecPow"), m.specPow);
    gl.uniform1f(u("uRimAmt"), m.rimAmt);
    gl.uniform1f(u("uGrain"), m.grain);
    gl.uniform1f(u("uCalm"), m.calm);
    gl.uniform3f(u("uCalmColor"), m.veil[0], m.veil[1], m.veil[2]);
    gl.uniform1f(u("uLightGain"), m.lightGain);
    gl.uniform1f(u("uViscosity"), this.viscosity);
    gl.uniform2f(u("uLensCenter"), this.lensCenter.x, this.lensCenter.y);
    gl.uniform2f(u("uLensRadii"), this.lensRadii.x, this.lensRadii.y);
    gl.uniform1f(u("uLensPower"), this.lensPower);
    gl.uniform1f(u("uLensDisp"), this.lensDisp);
    gl.uniform1f(u("uBevelPx"), this.edgeBand * this.effectiveDpr * 1.8);
    gl.uniform1f(u("uBevelAmt"), this.bevel * m.bevelScale);
    gl.uniform3f(u("uCaustic"), m.caustic[0], m.caustic[1], m.caustic[2]);
    gl.uniform1f(u("uCausticAmt"), this.causticAmt);
    gl.uniform3f(u("uCausticShade"), m.causticShade[0], m.causticShade[1], m.causticShade[2]);
    gl.uniform1f(u("uCausticShadeAmt"), m.causticShadeAmt);
    gl.uniform1f(u("uCausticGain"), m.causticGain);
    gl.uniform2f(u("uPointer"), 0.0, 0.0);
    gl.uniform1f(u("uPress"), 0.0);
    gl.uniform2f(u("uChangeOrigin"), this.waveOrigin.x, this.waveOrigin.y);
    gl.uniform1f(u("uChangeProgress"), this.waveProgress);
  }

  start(): void {
    if (this.destroyed || this.running || this.contextLost) return;
    if (this.reducedMotion) {
      this.scheduleStaticRender();
      return;
    }
    this.running = true;
    this.lastFrame = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  private frame = (now: number): void => {
    if (!this.running || this.destroyed) return;
    const dt = Math.min(0.05, Math.max(0.001, (now - this.lastFrame) / 1000));
    this.lastFrame = now;
    this.time += dt;
    this.update(dt);
    this.draw();
    this.trackQuality(dt);
    this.raf = requestAnimationFrame(this.frame);
  };

  private trackQuality(dt: number): void {
    this.frameTimes.push(dt * 1000);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    if (this.frameTimes.length < 60) return;
    const avg = this.frameTimes.reduce((sum, value) => sum + value, 0) / this.frameTimes.length;
    if (avg > 20 && this.qualityTier < 2) {
      this.qualityTier += 1;
      this.frameTimes.length = 0;
      this.resize(this.cssW, this.cssH);
    } else if (avg < 12 && this.qualityTier > 0) {
      this.qualityTier -= 1;
      this.frameTimes.length = 0;
      this.resize(this.cssW, this.cssH);
    }
  }

  private scheduleStaticRender(): void {
    if (this.staticRaf) cancelAnimationFrame(this.staticRaf);
    this.staticRaf = requestAnimationFrame(() => {
      this.staticRaf = 0;
      this.snapToTargets();
      this.draw();
    });
  }

  private snapToTargets(): void {
    this.material = targetMaterial(this.themeTarget);
    this.edgeBand = this.thicknessTarget.edgeBand;
    this.refract = this.thicknessTarget.refract;
    this.dispersion = this.thicknessTarget.dispersion;
    this.veilAlpha = this.thicknessTarget.veil[this.themeTarget.id];
    this.viscosity = this.viscosityTarget;
    const baseX0 = 0.5 + 0.025 * Math.sin(1.3);
    const baseY0 = 0.52 + 0.13 * Math.sin(0.6) + 0.02;
    this.lensCenter = { x: baseX0, y: baseY0 };
    this.lensRadii = { x: 0.38, y: 0.173 };
    this.lensPower = this.lensPowerTarget;
    this.causticAmt = this.causticAmtTarget;
    this.bevel = this.bevelTarget;
    this.lensDisp = this.lensDispTarget;
    this.pigmentA = { ...this.pigmentTargetA };
    this.pigmentB = { ...this.pigmentTargetB };
    this.waveProgress = 1;
    this.time = 0;
  }

  dispose(): void {
    this.destroyed = true;
    this.stop();
    if (this.staticRaf) cancelAnimationFrame(this.staticRaf);
    this.canvas.removeEventListener("webglcontextlost", this.handleContextLost);
    this.canvas.removeEventListener("webglcontextrestored", this.handleContextRestored);
    const gl = this.gl;
    if (this.sceneTexture) gl.deleteTexture(this.sceneTexture);
    if (this.sceneFramebuffer) gl.deleteFramebuffer(this.sceneFramebuffer);
    if (this.sceneProgram) gl.deleteProgram(this.sceneProgram);
    if (this.compositeProgram) gl.deleteProgram(this.compositeProgram);
    if (this.buffer) gl.deleteBuffer(this.buffer);
  }
}

const CHARACTER_A_PIGMENT: Rgb = [0x85 / 255, 0x3c / 255, 0x54 / 255];
const CHARACTER_B_PIGMENT: Rgb = [0xd8 / 255, 0x4d / 255, 0x56 / 255];
