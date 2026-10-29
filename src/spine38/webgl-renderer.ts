/* Web 端渲染器：自研 spine38 数值层 → 三角收集（对齐 ArkTS collect_triangles）→ WebGL。
   纹理口径：素材 PNG 已是预乘 alpha（透明像素 RGB=0），Blend 用 ONE / ONE_MINUS_SRC_ALPHA。 */
import { TextureAtlas, AtlasAttachmentLoaderImpl } from "./atlas";
import {
  SkeletonBinary,
  MeshAttachment,
  RegionAttachment,
  ClippingAttachment,
  BLEND_ADDITIVE,
  BLEND_MULTIPLY,
  BLEND_SCREEN,
  AtlasRegion,
  Animation,
} from "./loader";
import { Skeleton, compute_mesh_vertices, compute_region_vertices } from "./skeleton";
import { apply_animation } from "./animation";
import { clipAttachmentPolys, clipTriangleToPolys } from "./clipping";

// 入场/退场 dither 过渡时序（秒 / CSS px）。
// 游戏内 BornState 的体色补间与 Start/Die 动画同为 1.0s；但桌宠没有 Start/Die
// 的身体动作去填充这段时间，纯淡入淡出观感偏慢，按目视验收压到 0.25s。
// slotRiseSeconds / slotMaxDelaySeconds 是窗口内的相对比例，随 enter/exit 等比缩放。
export const REVEAL_TIMING = {
  enterSeconds: 0.25,
  exitSeconds: 0.25,
  slotRiseSeconds: 0.6,
  slotMaxDelaySeconds: 0.4,
  ditherCellCss: 2,
  ditherOpenEnd: 0.45,
  colorStart: 0.35,
} as const;

// 互动描边：方舟基建界面描边实测 #FFEB04、8 向、7 骨骼单位、alpha 裁切 0.1。
export const INTERACTION_OUTLINE = {
  color: [1, 235 / 255, 4 / 255] as const,
  offsetUnits: 7,
  cutoff: 0.1,
} as const;

// 描边自身的淡入淡出时长：与桌宠入场/退场同节奏。
export const OUTLINE_TIMING = {
  fadeSeconds: REVEAL_TIMING.enterSeconds,
} as const;

type DrawSlot = Skeleton["draw_order"][number];

export interface LoadedModel {
  skeleton: Skeleton;
  animations: Animation[];
  atlas: TextureAtlas;
  body: { head_y: number; ground_y: number; axis_x: number };
  // 按姿态补偿的垂直偏移（模型单位）：家具高度缺失时让脚/身体不被画布底边裁掉
  pose_offsets: Record<string, number>;
}

// 生产环境的 SPA fallback 会对缺失路径返回 index.html 且状态码 200；
// 只认 2xx 不够。不能靠 content-type 判断：Tauri asset 协议对 `.atlas`/`.skel`
// 这类未知扩展名一律兜底成 text/html（MimeType::parse），文件本身却是好的。
// 所以直接看内容开头是不是 HTML 文档。
const HTML_HEAD = /^\s*(<!doctype html|<html[\s>])/i;

async function fetch_asset(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`asset ${response.status}: ${url}`);
  }
  const buf = await response.arrayBuffer();
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    new Uint8Array(buf, 0, Math.min(buf.byteLength, 64)),
  );
  if (HTML_HEAD.test(head)) {
    throw new Error(`asset is HTML (SPA fallback): ${url}`);
  }
  return buf;
}

export async function load_model(base_dir: string, name: string): Promise<LoadedModel> {
  const [atlas_buf, skel_buf] = await Promise.all([
    fetch_asset(`${base_dir}/${name}.atlas`),
    fetch_asset(`${base_dir}/${name}.skel`),
  ]);
  const atlas_text = new TextDecoder().decode(atlas_buf);
  const atlas = new TextureAtlas(atlas_text, () => ({}));
  const loader = new AtlasAttachmentLoaderImpl(atlas);
  const sd = new SkeletonBinary(loader).read_skeleton_data(new Uint8Array(skel_buf));
  const skeleton = new Skeleton(sd);
  skeleton.set_to_setup_pose();
  skeleton.update_world_transform();

  // 尺寸锚点＝可见发顶→脚底（排除光环 F_Ring/F_Halo 与武器），setup 姿态
  const bounds = compute_slot_bounds(skeleton);
  const is_head = (n: string) => /head|hair/i.test(n) && !/halo|ring/i.test(n);
  const is_foot = (n: string) => /foot/i.test(n);
  let head_top = -Infinity;
  let ground = Infinity;
  for (const b of bounds) {
    if (is_head(b.name)) head_top = Math.max(head_top, b.maxY);
    if (is_foot(b.name)) ground = Math.min(ground, b.minY);
  }
  if (!isFinite(head_top)) head_top = Math.max(...bounds.map((b) => b.maxY));
  if (!isFinite(ground)) ground = Math.min(...bounds.map((b) => b.minY));
  // 原作里 Sit/Sleep 是家具交互姿态，原点在坐面/床面上，脚会低于站立地面。
  // 桌宠没有家具，这里按姿态最低点算一个垂直补偿，既还原坐高也避免被画布底边裁切。
  const pose_offsets: Record<string, number> = {};
  for (const anim of sd.animations) pose_offsets[anim.name] = 0;
  for (const name of ["Sit", "Sleep"]) {
    const anim = sd.animations.find((a) => a.name === name);
    if (!anim || anim.duration <= 0) continue;
    let minY = Infinity;
    for (const f of [0, 0.5, 0.999]) {
      skeleton.set_to_setup_pose();
      apply_animation(anim, skeleton, anim.duration * f, true);
      skeleton.update_world_transform();
      for (const b of compute_slot_bounds(skeleton)) {
        if (b.minY < minY) minY = b.minY;
      }
    }
    if (isFinite(minY)) pose_offsets[name] = Math.max(0, ground - minY);
  }
  skeleton.set_to_setup_pose();
  skeleton.update_world_transform();

  const head_bone = skeleton.bones.find((b) => b.data.name === "F_Head");
  return {
    skeleton,
    animations: sd.animations,
    atlas,
    body: {
      head_y: head_top,
      ground_y: ground,
      axis_x: head_bone ? head_bone.world_x : 0,
    },
    pose_offsets,
  };
}

function compute_slot_bounds(sk: Skeleton): { name: string; minY: number; maxY: number }[] {
  const rows: { name: string; minY: number; maxY: number }[] = [];
  for (const slot of sk.slots) {
    const attachment = slot.attachment;
    if (attachment === null) continue;
    let verts: number[] | null = null;
    if (attachment instanceof MeshAttachment) {
      verts = compute_mesh_vertices(
        slot,
        attachment,
        0,
        Math.floor(attachment.world_vertices_length / 2)
      );
    } else if (attachment instanceof RegionAttachment) {
      verts = compute_region_vertices(slot, attachment);
    }
    if (!verts) continue;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < verts.length; i += 2) {
      if (verts[i] < minY) minY = verts[i];
      if (verts[i] > maxY) maxY = verts[i];
    }
    rows.push({ name: slot.data.name, minY, maxY });
  }
  return rows;
}

const VS = `
attribute vec2 a_pos;
attribute vec2 a_uv;
varying vec2 v_uv;
uniform vec2 u_res;
uniform float u_yaw;
uniform float u_pivot;
void main() {
  float cx = u_pivot + (a_pos.x - u_pivot) * cos(u_yaw);
  vec2 clip = vec2(cx / u_res.x * 2.0 - 1.0, 1.0 - a_pos.y / u_res.y * 2.0);
  v_uv = a_uv;
  gl_Position = vec4(clip, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec4 u_color;
uniform float u_alpha;
uniform float u_reveal;
uniform float u_dither_cell;
const float DITHER_OPEN_END = ${REVEAL_TIMING.ditherOpenEnd.toFixed(4)};
const float COLOR_START = ${REVEAL_TIMING.colorStart.toFixed(4)};

float bayer2(float x, float y) {
  return 2.0 * x + y * (3.0 - 4.0 * x);
}

// 4x4 Bayer：0..15 的阈值均匀铺开，换算到 (0,1)
float bayer4(vec2 p) {
  vec2 q = mod(floor(p), 4.0);
  vec2 lo = mod(q, 2.0);
  vec2 hi = floor(q * 0.5);
  return (4.0 * bayer2(lo.x, lo.y) + bayer2(hi.x, hi.y) + 0.5) / 16.0;
}

void main() {
  vec4 t = texture2D(u_tex, v_uv);
  vec2 cell = floor(gl_FragCoord.xy / max(u_dither_cell, 1.0));
  float cover = smoothstep(0.0, DITHER_OPEN_END, u_reveal);
  float color_mix = smoothstep(COLOR_START, 1.0, u_reveal);
  float mask = step(bayer4(cell), cover);
  vec4 base = vec4(t.rgb * u_color.rgb * u_color.a, t.a * u_color.a) * u_alpha;
  // 预乘 alpha：颜色先压黑成剪影，再随 reveal 提亮；alpha 只受点阵遮罩控制。
  gl_FragColor = vec4(base.rgb * mask * color_mix, base.a * mask);
}`;

// 剪影预通道：只写 alpha，忽略各槽位混合模式，得到整个角色的并集轮廓。
const SILHOUETTE_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform float u_alpha;
void main() {
  float a = texture2D(u_tex, v_uv).a * u_alpha;
  gl_FragColor = vec4(0.0, 0.0, 0.0, a);
}`;

const QUAD_VS = `
attribute vec2 a_pos;
varying vec2 v_uv;
void main() {
  v_uv = a_pos * 0.5 + 0.5;
  gl_Position = vec4(a_pos, 0.0, 1.0);
}`;

// 把剪影膨胀后整体涂成描边色，画在角色下层。
// 光翼末端是极尖的针状：只在外圈采样会把尖端复制成一圈分离的“针”，
// 形成放射状尖刺。这里改成多环采样（半径 0.25/0.5/0.75/1.0 × 半径），
// 把外圈之间的楔形缺口也填上，近似真正的圆盘膨胀，尖端才会收成圆滑包边。
const OUTLINE_FS = `
precision mediump float;
varying vec2 v_uv;
uniform sampler2D u_tex;
uniform vec2 u_texel;
uniform float u_offset;
uniform vec3 u_color;
uniform float u_cutoff;
uniform float u_opacity;
const int OUTLINE_DIRS = 16;
const int OUTLINE_RINGS = 4;
const float STEP_COS = 0.9238795325112867;  // cos(2π/16)
const float STEP_SIN = 0.3826834323650898;  // sin(2π/16)
float alpha_at(vec2 uv) {
  return texture2D(u_tex, uv).a;
}
void main() {
  vec2 o = u_texel * u_offset;
  vec2 dir = vec2(1.0, 0.0);
  float a = 0.0;
  for (int i = 0; i < OUTLINE_DIRS; i++) {
    for (int j = 1; j <= OUTLINE_RINGS; j++) {
      a = max(a, alpha_at(v_uv + o * dir * (float(j) / float(OUTLINE_RINGS))));
    }
    dir = vec2(dir.x * STEP_COS - dir.y * STEP_SIN,
               dir.x * STEP_SIN + dir.y * STEP_COS);
  }
  float edge = step(u_cutoff, a) * u_opacity;
  gl_FragColor = vec4(u_color * edge, edge);
}`;

function load_image(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    // 已安装素材走 asset 协议（http://asset.localhost/...）：不声明 CORS，
    // texImage2D 会以画布被污染为由抛 SecurityError。
    if (/^https?:\/\//i.test(url)) img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed: " + url));
    img.src = url;
  });
}

function compile(gl: WebGLRenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new Error("createShader failed");
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(sh) || "shader compile failed");
  }
  return sh;
}

export class SpineWebGLRenderer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private posBuf: WebGLBuffer;
  private uvBuf: WebGLBuffer;
  private texture: WebGLTexture | null = null;
  private model: LoadedModel | null = null;
  private anim: Animation | null = null;
  private layout: { scale: number; tx: number; ty: number; w: number; h: number } | null = null;
  private pos: number[] = [];
  private uv: number[] = [];
  private boundL = Infinity;
  private boundT = Infinity;
  private boundR = -Infinity;
  private boundB = -Infinity;
  private lastBounds = { left: 0, top: 0, right: 0, bottom: 0 };
  private aPos = 0;
  private aUv = 0;
  private uTex: WebGLUniformLocation | null = null;
  private uColor: WebGLUniformLocation | null = null;
  private uAlpha: WebGLUniformLocation | null = null;
  private uRes: WebGLUniformLocation | null = null;
  private uYaw: WebGLUniformLocation | null = null;
  private uPivot: WebGLUniformLocation | null = null;
  private uReveal: WebGLUniformLocation | null = null;
  private uDitherCell: WebGLUniformLocation | null = null;
  private silProgram: WebGLProgram;
  private silTex: WebGLUniformLocation | null = null;
  private silAlpha: WebGLUniformLocation | null = null;
  private silRes: WebGLUniformLocation | null = null;
  private silYaw: WebGLUniformLocation | null = null;
  private silPivot: WebGLUniformLocation | null = null;
  private outlineProgram: WebGLProgram;
  private quadBuf: WebGLBuffer;
  private quadPos = 0;
  private outlineTex: WebGLUniformLocation | null = null;
  private outlineTexel: WebGLUniformLocation | null = null;
  private outlineOffset: WebGLUniformLocation | null = null;
  private outlineColor: WebGLUniformLocation | null = null;
  private outlineCutoff: WebGLUniformLocation | null = null;
  private outlineOpacity: WebGLUniformLocation | null = null;
  private fbo: WebGLFramebuffer | null = null;
  private fboTex: WebGLTexture | null = null;
  private fboW = 0;
  private fboH = 0;
  private outline = 0;
  private reveal = 1;
  private yaw = 0;
  private anim_loop = true;
  private prev_anim: Animation | null = null;
  private prev_loop = true;
  // 旧动画在切换瞬间的本地时间与速率；混合期间继续按原速率推进，避免相位跳变。
  private prev_time = 0;
  private prev_rate = 1;
  private mix_start = 0;
  private mix_duration = 0;
  // 当前动画的本地播放时钟：支持变速，且改变速率时相位不回跳。
  private anim_time = 0;
  private anim_last_now = 0;
  private anim_rate = 1;

  constructor(private canvas: HTMLCanvasElement) {
    const gl = canvas.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: true });
    if (!gl) throw new Error("WebGL unavailable");
    this.gl = gl;
    const makeProgram = (vs: string, fs: string): WebGLProgram => {
      const p = gl.createProgram();
      if (!p) throw new Error("createProgram failed");
      gl.bindAttribLocation(p, 0, "a_pos");
      gl.bindAttribLocation(p, 1, "a_uv");
      gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
      gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
        throw new Error(gl.getProgramInfoLog(p) || "program link failed");
      }
      return p;
    };
    const program = makeProgram(VS, FS);
    this.program = program;
    this.aPos = gl.getAttribLocation(program, "a_pos");
    this.aUv = gl.getAttribLocation(program, "a_uv");
    this.uTex = gl.getUniformLocation(program, "u_tex");
    this.uColor = gl.getUniformLocation(program, "u_color");
    this.uAlpha = gl.getUniformLocation(program, "u_alpha");
    this.uRes = gl.getUniformLocation(program, "u_res");
    this.uYaw = gl.getUniformLocation(program, "u_yaw");
    this.uPivot = gl.getUniformLocation(program, "u_pivot");
    this.uReveal = gl.getUniformLocation(program, "u_reveal");
    this.uDitherCell = gl.getUniformLocation(program, "u_dither_cell");

    const sil = makeProgram(VS, SILHOUETTE_FS);
    this.silProgram = sil;
    this.silTex = gl.getUniformLocation(sil, "u_tex");
    this.silAlpha = gl.getUniformLocation(sil, "u_alpha");
    this.silRes = gl.getUniformLocation(sil, "u_res");
    this.silYaw = gl.getUniformLocation(sil, "u_yaw");
    this.silPivot = gl.getUniformLocation(sil, "u_pivot");

    const outlineProgram = makeProgram(QUAD_VS, OUTLINE_FS);
    this.outlineProgram = outlineProgram;
    this.quadPos = gl.getAttribLocation(outlineProgram, "a_pos");
    this.outlineTex = gl.getUniformLocation(outlineProgram, "u_tex");
    this.outlineTexel = gl.getUniformLocation(outlineProgram, "u_texel");
    this.outlineOffset = gl.getUniformLocation(outlineProgram, "u_offset");
    this.outlineColor = gl.getUniformLocation(outlineProgram, "u_color");
    this.outlineCutoff = gl.getUniformLocation(outlineProgram, "u_cutoff");
    this.outlineOpacity = gl.getUniformLocation(outlineProgram, "u_opacity");

    const posBuf = gl.createBuffer();
    const uvBuf = gl.createBuffer();
    const quadBuf = gl.createBuffer();
    if (!posBuf || !uvBuf || !quadBuf) throw new Error("createBuffer failed");
    this.posBuf = posBuf;
    this.uvBuf = uvBuf;
    this.quadBuf = quadBuf;
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
      gl.STATIC_DRAW
    );
  }

  set_yaw(rad: number): void {
    this.yaw = rad;
  }

  set_reveal(value: number): void {
    this.reveal = Math.min(1, Math.max(0, value));
  }

  set_outline(opacity: number): void {
    this.outline = Math.min(1, Math.max(0, opacity));
  }

  current_animation_name(): string | null {
    return this.anim ? this.anim.name : null;
  }

  // 只影响当前动画的播放速率；时间用累加器推进，改速率不会让相位跳变。
  set_animation_time_scale(rate: number): void {
    this.anim_rate =
      Number.isFinite(rate) && rate > 0 ? Math.min(4, Math.max(0.1, rate)) : 1;
  }

  set_animation(name: string, loop = true, restart = false, mix_duration = 0): void {
    const model = this.model;
    if (!model) return;
    const next = model.animations.find((a) => a.name === name) ?? null;
    if (next === this.anim && loop === this.anim_loop && !restart) return;
    const now = performance.now();
    if (next !== null && next !== this.anim && mix_duration > 0 && this.anim !== null) {
      // Spine 口径：旧动画继续按原速播，新动画以 alpha 0→1 混入（对称淡入淡出）
      this.prev_anim = this.anim;
      this.prev_loop = this.anim_loop;
      this.prev_time = this.anim_time;
      this.prev_rate = this.anim_rate;
      this.mix_start = now;
      this.mix_duration = mix_duration;
    } else {
      this.prev_anim = null;
      this.mix_duration = 0;
    }
    this.anim = next;
    this.anim_loop = loop;
    this.anim_time = 0;
    this.anim_last_now = 0;
  }

  async set_model(model: LoadedModel, base_dir: string): Promise<void> {
    this.model = model;
    this.anim =
      model.animations.find((a) => a.name === "Relax") ??
      model.animations.find((a) => a.name === "Default") ??
      null;
    this.anim_loop = true;
    this.anim_time = 0;
    this.anim_last_now = 0;
    this.anim_rate = 1;
    const page = model.atlas.pages[0];
    const img = await load_image(`${base_dir}/${page.name}`);
    const gl = this.gl;
    const tex = gl.createTexture();
    if (!tex) throw new Error("createTexture failed");
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    this.texture = tex;
  }

  private compute_layout(w: number, h: number, model: LoadedModel) {
    const dpr = window.devicePixelRatio || 1;
    const body_h = Math.max(1, model.body.head_y - model.body.ground_y);
    // 定案口径：发顶→脚底＝屏幕高×16.3%（时装展示页小人的复刻比例）
    const target_css = Math.min(window.screen.height * 0.163, (h / dpr) * 0.9);
    const scale = (target_css * dpr) / body_h;
    const tx = w / 2 - model.body.axis_x * scale;
    const ty = Math.max(6, Math.round(h * 0.04));
    return { scale, tx, ty, w, h };
  }

  draw(): void {
    const model = this.model;
    if (!model || !this.texture) return;
    const sk = model.skeleton;
    let y_offset = 0;
    let dim_alpha = 1;
    if (this.anim) {
      const now = performance.now();
      // 本地时钟按 dt × rate 累加：速率变化（冲刺/滑行）不会让动画相位跳变。
      const last = this.anim_last_now || now;
      this.anim_last_now = now;
      const frame_dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
      this.anim_time += frame_dt * this.anim_rate;
      sk.set_to_setup_pose();
      const offsets = model.pose_offsets;
      const cur_off = offsets[this.anim.name] ?? 0;
      let prev_off = cur_off;
      let weight = 1;
      let mixing = false;
      if (this.prev_anim && this.mix_duration > 0) {
        const w = Math.min(
          1,
          Math.max(0, (now - this.mix_start) / (this.mix_duration * 1000))
        );
        const prev_name = this.prev_anim.name;
        prev_off = offsets[prev_name] ?? 0;
        const prev_elapsed =
          this.prev_time + ((now - this.mix_start) / 1000) * this.prev_rate;
        const prev_t =
          this.prev_loop || this.prev_anim.duration <= 0
            ? prev_elapsed
            : Math.min(prev_elapsed, this.prev_anim.duration);
        apply_animation(this.prev_anim, sk, prev_t, this.prev_loop, 1.0);
        weight = w;
        mixing = true;
        y_offset = prev_off + (cur_off - prev_off) * w;
        // 原作家具交互有“切换时暗一下”的观感；桌宠无家具，把它做成 Sit/Sleep 过渡的暗场。
        // 官方曲线 1s（0.125 淡出 / 隐藏到 0.5 / 0.5s 淡入），这里按过渡时长缩放并抬到 0.25 保留可见度。
        if (prev_name === "Sit" || prev_name === "Sleep" ||
            this.anim.name === "Sit" || this.anim.name === "Sleep") {
          const dip = 0.25;
          if (w < 0.125) dim_alpha = 1 - (1 - dip) * (w / 0.125);
          else if (w < 0.5) dim_alpha = dip;
          else dim_alpha = dip + (1 - dip) * Math.min(1, (w - 0.5) / 0.5);
        }
        if (w >= 1) {
          this.prev_anim = null;
          this.mix_duration = 0;
        }
      } else {
        y_offset = cur_off;
      }
      const elapsed = this.anim_time;
      const duration = this.anim.duration;
      const t =
        this.anim_loop || duration <= 0 ? elapsed : Math.min(elapsed, duration);
      // 混入段不再重置约束，让 IK/Transform 从旧姿态平滑过渡到新姿态
      apply_animation(this.anim, sk, t, this.anim_loop, weight, !mixing);
    }
    sk.update_world_transform();

    const dpr = window.devicePixelRatio || 1;
    const cw = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const ch = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== cw || this.canvas.height !== ch) {
      this.canvas.width = cw;
      this.canvas.height = ch;
    }
    if (!this.layout || this.layout.w !== cw || this.layout.h !== ch) {
      this.layout = this.compute_layout(cw, ch, model);
    }
    const { scale, tx, ty } = this.layout;

    const gl = this.gl;
    const outlineReady = this.outline > 0 && this.ensureOutlineTarget(cw, ch);

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (outlineReady) {
      // 1) 剪影并集 → FBO（忽略槽位混合模式，只累计 alpha）
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      gl.viewport(0, 0, cw, ch);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(this.silProgram);
      gl.uniform2f(this.silRes, cw, ch);
      gl.uniform1f(this.silYaw, this.yaw);
      gl.uniform1f(this.silPivot, cw / 2);
      gl.uniform1i(this.silTex, 0);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.texture);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      this.buildSlotGeometry(sk, scale, tx, ty, ch, y_offset, false, (slot) => {
        gl.uniform1f(this.silAlpha, slot.color.a);
      });

      // 2) 多环圆盘膨胀 + 裁切 → 描边色，垫在角色下层
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, cw, ch);
      gl.useProgram(this.outlineProgram);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.uniform1i(this.outlineTex, 0);
      gl.uniform2f(this.outlineTexel, 1 / cw, 1 / ch);
      gl.uniform1f(this.outlineOffset, INTERACTION_OUTLINE.offsetUnits * scale);
      gl.uniform3f(
        this.outlineColor,
        INTERACTION_OUTLINE.color[0],
        INTERACTION_OUTLINE.color[1],
        INTERACTION_OUTLINE.color[2]
      );
      gl.uniform1f(this.outlineCutoff, INTERACTION_OUTLINE.cutoff);
      gl.uniform1f(this.outlineOpacity, this.outline);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
      gl.enableVertexAttribArray(this.quadPos);
      gl.vertexAttribPointer(this.quadPos, 2, gl.FLOAT, false, 0, 0);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }

    // 正常角色
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, cw, ch);
    gl.useProgram(this.program);
    gl.uniform2f(this.uRes, cw, ch);
    gl.uniform1f(this.uYaw, this.yaw);
    gl.uniform1f(this.uPivot, cw / 2);
    gl.uniform1f(this.uAlpha, dim_alpha);
    gl.uniform1f(
      this.uDitherCell,
      Math.max(1, dpr * REVEAL_TIMING.ditherCellCss)
    );
    gl.uniform1i(this.uTex, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.enable(gl.BLEND);

    const revealSpan =
      REVEAL_TIMING.slotMaxDelaySeconds + REVEAL_TIMING.slotRiseSeconds;
    this.buildSlotGeometry(sk, scale, tx, ty, ch, y_offset, true, (slot) => {
      const c = slot.color;
      gl.uniform4f(this.uColor, c.r, c.g, c.b, c.a);
      // 逐槽位错峰：黄金比例散列让相邻零件不同步，最多延迟 slotMaxDelaySeconds。
      const slotDelay =
        ((slot.data.index * 0.6180339887) % 1) *
        REVEAL_TIMING.slotMaxDelaySeconds;
      const slotReveal = Math.min(
        1,
        Math.max(
          0,
          (this.reveal * revealSpan - slotDelay) /
            REVEAL_TIMING.slotRiseSeconds
        )
      );
      gl.uniform1f(this.uReveal, slotReveal);
      set_blend(gl, slot.data.blend_mode);
    });

    if (isFinite(this.boundL)) {
      // 着色器按 yaw 绕画布中线变换 x（π 时整体镜像）；包围盒必须跟着变换，
      // 否则朝左走时按镜像前的零件算边界，会提前停住留出空隙。
      const pivot = cw / 2;
      const c = Math.cos(this.yaw);
      const ax = pivot + (this.boundL - pivot) * c;
      const bx = pivot + (this.boundR - pivot) * c;
      this.lastBounds = {
        left: Math.min(ax, bx) / dpr,
        top: this.boundT / dpr,
        right: Math.max(ax, bx) / dpr,
        bottom: this.boundB / dpr,
      };
    }
  }

  // 把当前骨架按槽位拆成三角形并绘制；paint 在每槽上传顶点后、draw 前设置该槽的 uniform/混合。
  private buildSlotGeometry(
    sk: Skeleton,
    scale: number,
    tx: number,
    ty: number,
    ch: number,
    y_offset: number,
    trackBounds: boolean,
    paint: (slot: DrawSlot) => void
  ): void {
    const gl = this.gl;
    if (trackBounds) {
      this.boundL = Infinity;
      this.boundT = Infinity;
      this.boundR = -Infinity;
      this.boundB = -Infinity;
    }
    // 活动边界按“看得见的零件”算：alpha≈0 的槽位仍绘制，但不计入包围盒。
    let trackSlotBounds = trackBounds;
    const add = (x: number, y: number, u: number, v: number): void => {
      const px = x * scale + tx;
      const py = ch - ((y + y_offset) * scale + ty);
      if (trackSlotBounds) {
        if (px < this.boundL) this.boundL = px;
        if (px > this.boundR) this.boundR = px;
        if (py < this.boundT) this.boundT = py;
        if (py > this.boundB) this.boundB = py;
      }
      this.pos.push(px, py);
      this.uv.push(u, v);
    };

    let clipPolys: number[][] | null = null;
    let clip_end_index = -1;
    for (const slot of sk.draw_order) {
      const attachment = slot.attachment;
      if (attachment === null) {
        if (clipPolys !== null && slot.data.index === clip_end_index) {
          clipPolys = null;
          clip_end_index = -1;
        }
        continue;
      }
      if (attachment instanceof ClippingAttachment) {
        if (clipPolys === null) {
          const verts = compute_mesh_vertices(
            slot,
            attachment,
            0,
            Math.floor(attachment.world_vertices_length / 2)
          );
          clipPolys = clipAttachmentPolys(verts);
          clip_end_index = attachment.end_slot !== null ? attachment.end_slot.index : sk.slots.length;
        }
        continue;
      }

      let verts: number[];
      let triangles: number[];
      let uvs: number[];
      let region: AtlasRegion | null = null;
      if (attachment instanceof RegionAttachment) {
        verts = compute_region_vertices(slot, attachment);
        triangles = [0, 1, 2, 2, 3, 0];
        const r = attachment.region;
        region = r;
        if (!r) continue;
        uvs =
          r.degrees === 90
            ? [r.u2, r.v2, r.u, r.v2, r.u, r.v, r.u2, r.v]
            : [r.u, r.v2, r.u, r.v, r.u2, r.v, r.u2, r.v2];
      } else if (attachment instanceof MeshAttachment) {
        verts = compute_mesh_vertices(
          slot,
          attachment,
          0,
          Math.floor(attachment.world_vertices_length / 2)
        );
        triangles = attachment.triangles ?? [];
        uvs = attachment.uvs ?? [];
        region = attachment.region;
      } else {
        continue;
      }
      if (!region || triangles.length === 0 || uvs.length === 0) continue;

      trackSlotBounds = trackBounds && slot.color.a > 0.001;
      this.pos.length = 0;
      this.uv.length = 0;
      if (clipPolys !== null) {
        for (let t = 0; t < triangles.length; t += 3) {
          const i0 = triangles[t] * 2;
          const i1 = triangles[t + 1] * 2;
          const i2 = triangles[t + 2] * 2;
          const results = clipTriangleToPolys(
            [verts[i0], verts[i0 + 1], verts[i1], verts[i1 + 1], verts[i2], verts[i2 + 1]],
            [uvs[i0], uvs[i0 + 1], uvs[i1], uvs[i1 + 1], uvs[i2], uvs[i2 + 1]],
            clipPolys
          );
          for (const r of results) {
            const m = Math.floor(r.pts.length / 2);
            for (let f = 1; f < m - 1; f++) {
              add(r.pts[0], r.pts[1], r.uvs[0], r.uvs[1]);
              add(r.pts[f * 2], r.pts[f * 2 + 1], r.uvs[f * 2], r.uvs[f * 2 + 1]);
              add(
                r.pts[(f + 1) * 2],
                r.pts[(f + 1) * 2 + 1],
                r.uvs[(f + 1) * 2],
                r.uvs[(f + 1) * 2 + 1]
              );
            }
          }
        }
      } else {
        for (let t = 0; t < triangles.length; t += 3) {
          const i0 = triangles[t] * 2;
          const i1 = triangles[t + 1] * 2;
          const i2 = triangles[t + 2] * 2;
          add(verts[i0], verts[i0 + 1], uvs[i0], uvs[i0 + 1]);
          add(verts[i1], verts[i1 + 1], uvs[i1], uvs[i1 + 1]);
          add(verts[i2], verts[i2 + 1], uvs[i2], uvs[i2 + 1]);
        }
      }
      if (this.pos.length === 0) continue;

      gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.pos), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 2, gl.FLOAT, false, 0, 0);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.uvBuf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(this.uv), gl.DYNAMIC_DRAW);
      gl.enableVertexAttribArray(this.aUv);
      gl.vertexAttribPointer(this.aUv, 2, gl.FLOAT, false, 0, 0);
      paint(slot);
      gl.drawArrays(gl.TRIANGLES, 0, this.pos.length / 2);

      if (clipPolys !== null && slot.data.index === clip_end_index) {
        clipPolys = null;
        clip_end_index = -1;
      }
    }
  }

  private ensureOutlineTarget(w: number, h: number): boolean {
    const gl = this.gl;
    if (!this.fbo || !this.fboTex) {
      const fbo = gl.createFramebuffer();
      const tex = gl.createTexture();
      if (!fbo || !tex) return false;
      this.fbo = fbo;
      this.fboTex = tex;
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
      this.fboW = w;
      this.fboH = h;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        tex,
        0
      );
      const ok =
        gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) return false;
    }
    if (this.fboW !== w || this.fboH !== h) {
      gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        w,
        h,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        null
      );
      this.fboW = w;
      this.fboH = h;
    }
    return true;
  }

  content_bounds_css(): { left: number; top: number; right: number; bottom: number } {
    return this.lastBounds;
  }
}

function set_blend(gl: WebGLRenderingContext, mode: number): void {
  if (mode === BLEND_ADDITIVE) {
    gl.blendFunc(gl.ONE, gl.ONE);
  } else if (mode === BLEND_MULTIPLY) {
    gl.blendFunc(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA);
  } else if (mode === BLEND_SCREEN) {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_COLOR);
  } else {
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }
}
