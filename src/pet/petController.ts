import { OUTLINE_TIMING, REVEAL_TIMING } from "../spine38/webgl-renderer";
import type { SpineWebGLRenderer } from "../spine38/webgl-renderer";
import type { Gear, GeoLocation, PetMode, VirtualTime } from "../settings/store";
import { GEAR_PRESETS } from "./behavior-presets.ts";
import type { Behavior } from "./behavior-presets.ts";
import {
  cancelMovement,
  clampPosition,
  createMovementState,
  pickWalk,
  setMovementPosition,
  stepMovement,
} from "./movement.ts";
import type {
  Bounds,
  MoveOptions,
  MovementState,
  Rng,
} from "./movement.ts";
import { getPhase } from "./solar.ts";
import type { PhaseId } from "./solar.ts";
import { allowsSleep, getPhaseBehavior } from "./phase-behavior.ts";
import {
  dateAtParts,
  datePartsFromDate,
  parseIsoDate,
} from "./calendar.ts";

export type PetActivity = "idle" | "walk" | "turn" | "poke" | "sit" | "sleep";

export type SharedPetSettings = {
  mode: PetMode;
  location: GeoLocation;
  virtualTime: VirtualTime | null;
  virtualEpoch: number;
};

export type PetProfile = {
  hasSit: boolean;
  hasSleep: boolean;
  sitSeconds: number;
  pokeSeconds: number;
};

export type PetControllerOptions = {
  renderer: SpineWebGLRenderer;
  shared: SharedPetSettings;
  gear: Gear;
  profile: PetProfile;
  start: { x: number; y: number };
  bounds: Bounds;
  // 可选：按当前渲染内容动态计算活动范围；返回 null 时沿用 bounds。
  boundsProvider?: () => Bounds | null;
  options: MoveOptions;
  // Shift 时的绝对速度（CSS px/s），按游戏基建操控模式的最高移动速度换算。
  sprintSpeed: number;
  seed: number;
  rng: Rng;
};

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const POSE_POKE_LEAD_SECONDS = 0.2;
// 戳一戳被行走打断时，Interact → Move 的混合时长。
// 比默认 0.2s 快，观感上就是骨骼权重迅速回正后开始行走。
const POKE_CANCEL_BLEND_SECONDS = 0.08;

// 手动操控：Shift 切换到基建操控模式的最高移动速度。
// 松键后的滑行分两档：冲刺释放用「恒定 + 线性」复合摩擦收住（末端不会低速蹭），
// 步行释放保持原来的柔和指数滑行；两档分开，避免冲刺的强刹车改变日常走停。
const MANUAL_MOTION = {
  accelerateTauSeconds: 0.08,
  glideTauSeconds: 0.2,
  walkStopSpeed: 6,
  // 释放速度高于 1.5× 步行速度时进入冲刺刹车；一旦进入就保持到停住。
  brakeBandWalkRatio: 1.5,
  // 复合摩擦 dv/dt = -(a0 + k·v)：a0 按步行速度缩放，保证不同屏幕高度下手感一致。
  brakeConstantWalkSpeeds: 16,
  brakeLinear: 6,
  // 冲刺刹车在 0.33× 步行速度处收住（能天使约 25 px/s）。
  sprintStopWalkRatio: 0.33,
  // 手动停步时 Move → Relax 的混合时长。
  stopBlendSeconds: 0.1,
  // Move 播放速率跟实际速度走，夹在 0.6～2.0×，避免冲刺时脚步定速滑步。
  animRateMin: 0.6,
  animRateMax: 2.0,
} as const;

// 溜冰惯性（总控台可开关）：沿用复合摩擦，但系数低得多，冲刺松手后长距离滑行。
// 能天使冲刺速度下约 1.7s / 360px 滑完；普通步行释放仍走上面的柔和指数滑行。
const ICE_MOTION = {
  brakeConstantWalkSpeeds: 0.6,
  brakeLinear: 2.0,
  // 滑行末段在 0.08× 步行速度处收住（能天使约 6 px/s），保留冰面漂移感又不起低速尾巴。
  stopWalkRatio: 0.08,
  walkStopSpeed: 6,
  stopBlendSeconds: 0.12,
} as const;

export class PetController {
  private readonly renderer: SpineWebGLRenderer;
  private readonly shared: SharedPetSettings;
  private readonly profile: PetProfile;
  private readonly options: MoveOptions;
  private readonly sprintSpeed: number;
  private readonly rng: Rng;
  private readonly boundsProvider?: () => Bounds | null;
  private gear: Gear;
  private bounds: Bounds;
  private move: MovementState;
  private mode: PetActivity = "idle";
  private idleTime = 0;
  private idleLimit = 0;
  private pokeT = 0;
  private pokeLead = 0;
  private sitTime = 0;
  private sleepTime = 0;
  private sleepLimit = 0;
  private lastPhase: PhaseId | null = null;
  private lastPhaseCheck = -Infinity;
  private lastPhaseEpoch = -1;
  private visible = false;
  private reveal = 0;
  private revealDir: -1 | 0 | 1 = 0;
  private manual = false;
  private outline = true;
  private outlineAlpha = 0;
  private manualVelX = 0;
  private manualVelY = 0;
  // 冲刺释放后保持复合刹车，直到停住；中途不切回指数滑行，避免低速尾巴。
  private sprintBraking = false;
  // 溜冰惯性开关：只改冲刺释放的摩擦系数，不影响步行收步。
  private iceGlide = false;
  private dragging = false;
  private moved = false;
  private downX = 0;
  private downY = 0;
  private downAt = 0;
  private dragOffX = 0;
  private dragOffY = 0;

  constructor(opts: PetControllerOptions) {
    this.renderer = opts.renderer;
    this.shared = opts.shared;
    this.gear = opts.gear;
    this.profile = opts.profile;
    this.options = opts.options;
    this.sprintSpeed = opts.sprintSpeed;
    this.bounds = opts.bounds;
    this.boundsProvider = opts.boundsProvider;
    this.rng = opts.rng;
    this.move = createMovementState(
      opts.start,
      opts.bounds,
      opts.seed,
      opts.options,
    );
    this.idleLimit = rand(this.pres().idleMin, this.pres().idleMax);
    this.lastPhase =
      this.shared.mode === "time" ? this.phaseInfo().phase : null;
    this.lastPhaseEpoch = this.shared.virtualEpoch;
    this.renderer.set_yaw(this.move.yaw);
    this.play("Relax");
  }

  get pos(): { x: number; y: number } {
    return this.move.pos;
  }

  get isVisible(): boolean {
    return this.visible;
  }

  // 过渡中不接受点击/拖动/F 控制；完全显示且静止时才可交互。
  get isInteractive(): boolean {
    return this.visible && this.reveal >= 1 && this.revealDir === 0;
  }

  get isDragging(): boolean {
    return this.dragging;
  }

  get currentMode(): PetActivity {
    return this.mode;
  }

  setGear(gear: Gear): void {
    this.gear = gear;
  }

  setOutline(enabled: boolean): void {
    this.outline = enabled;
  }

  setIceGlide(enabled: boolean): void {
    this.iceGlide = enabled;
  }

  setBounds(bounds: Bounds): void {
    this.bounds = bounds;
    this.move = {
      ...this.move,
      pos: clampPosition(this.move.pos, bounds),
    };
  }

  contentBox(): Bounds | null {
    const b = this.renderer.content_bounds_css();
    if (b.right <= b.left || b.bottom <= b.top) return null;
    return b;
  }

  // 用当前渲染内容刷新活动范围；不在这里夹紧位置，越界回走交给 pickWalk/手动移动处理。
  refreshBoundsFromContent(): void {
    const next = this.boundsProvider?.();
    if (next) this.bounds = next;
  }

  draw(): void {
    if (!this.visible) return;
    this.renderer.set_reveal(this.reveal);
    // 互动（手动操控）时淡入基建界面同款黄色描边；退出互动/关闭开关时淡出。
    this.renderer.set_outline(this.outlineAlpha);
    this.renderer.draw();
  }

  private behaviorNow(): Date {
    const virtual = this.shared.virtualTime;
    if (
      this.shared.mode !== "time" ||
      !virtual ||
      (virtual.date === null && virtual.minute === null)
    ) {
      return new Date();
    }
    const now = new Date();
    const parts = virtual.date ? parseIsoDate(virtual.date) : null;
    const base = parts ?? datePartsFromDate(now);
    const minute =
      virtual.minute ??
      now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    return dateAtParts(base, minute);
  }

  private phaseInfo() {
    return getPhase(
      this.behaviorNow(),
      this.shared.location.lat,
      this.shared.location.lon,
    );
  }

  private pres(): Behavior {
    if (this.shared.mode === "time") {
      const info = this.phaseInfo();
      return getPhaseBehavior(
        info.phase,
        info.solar.dayLengthMs / 3_600_000,
      );
    }
    return GEAR_PRESETS[this.gear];
  }

  private play(
    name: string,
    loop = true,
    restart = false,
    mix?: number,
  ): void {
    const prev = this.renderer.current_animation_name();
    const blend =
      mix !== undefined
        ? mix
        : name === "Move" || name === "Sit" || name === "Sleep"
          ? 0.2
          : name === "Relax"
            ? prev === "Move" || prev === "Sit" || prev === "Sleep"
              ? 0.2
              : 0
            : 0;
    this.renderer.set_animation(name, loop, restart, blend);
    // 播放倍速只属于手动 Move；切到其它动作时回到 1×。
    // 放在 set_animation 之后：让混出中的旧动画先按它自己的速率被记录。
    if (name !== "Move") this.renderer.set_animation_time_scale(1);
  }

  private resetManualVelocity(): void {
    this.manualVelX = 0;
    this.manualVelY = 0;
    this.sprintBraking = false;
  }

  private toIdle(): void {
    this.move = cancelMovement(this.move, true);
    this.resetManualVelocity();
    this.renderer.set_yaw(this.move.yaw);
    this.mode = "idle";
    this.pokeLead = 0;
    this.idleTime = 0;
    this.idleLimit = rand(this.pres().idleMin, this.pres().idleMax);
  }

  private pickNext(): void {
    // 选下一个目标前刷新活动范围，让 Spine 可见零件能够贴到屏幕边缘。
    this.refreshBoundsFromContent();
    const p = this.pres();
    const roll = Math.random();
    if (roll < p.pWalk) {
      const next = pickWalk(this.move, this.bounds, this.rng, this.options);
      if (!next) {
        this.toIdle();
        return;
      }
      this.move = next;
      this.mode = next.phase === "turn" ? "turn" : "walk";
    } else if (this.profile.hasSit && roll < p.pWalk + p.pSit) {
      this.mode = "sit";
      this.sitTime = 0;
    } else if (
      this.profile.hasSleep &&
      roll < p.pWalk + p.pSit + p.pSleep
    ) {
      this.mode = "sleep";
      this.sleepTime = 0;
      this.sleepLimit = rand(p.sleepMin, p.sleepMax);
    } else {
      this.toIdle();
    }
  }

  get isManual(): boolean {
    return this.manual;
  }

  beginManual(): void {
    if (!this.isInteractive) return;
    this.manual = true;
    this.dragging = false;
    this.toIdle();
  }

  endManual(): void {
    if (!this.manual) return;
    this.manual = false;
    this.toIdle();
  }

  manualMove(dx: number, dy: number, dt: number, sprint = false): void {
    if (!this.isInteractive || !this.manual) return;
    const delta = Math.min(0.05, Math.max(0, dt));
    if (delta <= 0) return;
    // 手动操控每帧按当前渲染内容刷新范围，撞边的手感与可见零件一致。
    this.refreshBoundsFromContent();

    const len = Math.hypot(dx, dy);
    const hasInput = len >= 1e-6;
    // 没被行走打断时，poke 期间不参与移动/滑行计算，否则会被 Relax 顶掉。
    if (this.mode === "poke" && !hasInput) return;
    // 行走输入打断戳一戳：游戏内骨骼权重迅速回正后直接行走。
    // 放在 hasInput 判定之后：不按方向键时 Interact 仍完整播完。
    let resumeFromPoke = false;
    if (hasInput && this.mode === "poke") {
      this.mode = "idle";
      this.pokeT = 0;
      this.pokeLead = 0;
      resumeFromPoke = true;
    }
    const walkSpeed = this.options.speed;
    const speed = Math.hypot(this.manualVelX, this.manualVelY);

    if (hasInput) {
      this.sprintBraking = false;
      const targetSpeed = sprint ? this.sprintSpeed : walkSpeed;
      const targetX = (dx / len) * targetSpeed;
      const targetY = (dy / len) * targetSpeed;
      const blend =
        1 - Math.exp(-delta / MANUAL_MOTION.accelerateTauSeconds);
      this.manualVelX += (targetX - this.manualVelX) * blend;
      this.manualVelY += (targetY - this.manualVelY) * blend;
    } else {
      // 从冲刺速度释放才进入复合刹车；一旦开始就保持到停住，
      // 否则降到 1.5× 步行速度时会切回指数滑行，低速尾巴又出来了。
      if (speed >= walkSpeed * MANUAL_MOTION.brakeBandWalkRatio) {
        this.sprintBraking = true;
      }
      if (this.sprintBraking) {
        const ice = this.iceGlide;
        const decel = ice
          ? (ICE_MOTION.brakeConstantWalkSpeeds * walkSpeed +
              ICE_MOTION.brakeLinear * speed) *
            delta
          : (MANUAL_MOTION.brakeConstantWalkSpeeds * walkSpeed +
              MANUAL_MOTION.brakeLinear * speed) *
            delta;
        const nextSpeed = Math.max(0, speed - decel);
        const stopAt = ice
          ? Math.max(
              ICE_MOTION.walkStopSpeed,
              walkSpeed * ICE_MOTION.stopWalkRatio,
            )
          : Math.max(
              MANUAL_MOTION.walkStopSpeed,
              walkSpeed * MANUAL_MOTION.sprintStopWalkRatio,
            );
        if (speed <= 1e-6 || nextSpeed <= stopAt) {
          this.resetManualVelocity();
          this.play(
            "Relax",
            true,
            false,
            ice
              ? ICE_MOTION.stopBlendSeconds
              : MANUAL_MOTION.stopBlendSeconds,
          );
          return;
        }
        const scale = nextSpeed / speed;
        this.manualVelX *= scale;
        this.manualVelY *= scale;
      } else {
        const blend = 1 - Math.exp(-delta / MANUAL_MOTION.glideTauSeconds);
        this.manualVelX += (0 - this.manualVelX) * blend;
        this.manualVelY += (0 - this.manualVelY) * blend;
        const glideSpeed = Math.hypot(this.manualVelX, this.manualVelY);
        if (glideSpeed < MANUAL_MOTION.walkStopSpeed) {
          this.resetManualVelocity();
          this.play("Relax", true, false, MANUAL_MOTION.stopBlendSeconds);
          return;
        }
      }
    }

    const intendedX = this.move.pos.x + this.manualVelX * delta;
    const intendedY = this.move.pos.y + this.manualVelY * delta;
    const next = clampPosition(
      { x: intendedX, y: intendedY },
      this.bounds,
    );
    // 撞到边界时清掉朝墙的分量，松键后不会贴着屏幕边缘继续“滑”。
    if (next.x !== intendedX) this.manualVelX = 0;
    if (next.y !== intendedY) this.manualVelY = 0;

    let facing = this.move.facing;
    if (hasInput && Math.abs(dx) > 1e-6) {
      facing = dx > 0 ? 1 : -1;
    } else if (!hasInput && Math.abs(this.manualVelX) > 1e-6) {
      facing = this.manualVelX > 0 ? 1 : -1;
    }
    this.move = {
      ...setMovementPosition(this.move, next),
      facing,
      yaw: facing === 1 ? 0 : Math.PI,
    };
    this.renderer.set_yaw(this.move.yaw);
    // 溜冰滑行：松手立刻切回待机动作，让角色保持站姿滑出去。
    // 此时不能再驱动 Move 的播放倍速，否则待机动画会被拽成慢动作。
    if (this.iceGlide && this.sprintBraking) {
      this.play("Relax");
      return;
    }
    // 播放速率跟实际速度走：冲刺 2×，滑行时随速度降回 0.6×，避免脚步定速滑步。
    // 先切动作再设倍速，混出中的旧动作才能保留它自己的速率。
    // 打断戳一戳的这一帧用短混合，让 Interact 的权重迅速交还给 Move。
    this.play("Move", true, false, resumeFromPoke ? POKE_CANCEL_BLEND_SECONDS : undefined);
    const speedNow = Math.hypot(this.manualVelX, this.manualVelY);
    this.renderer.set_animation_time_scale(
      Math.min(
        MANUAL_MOTION.animRateMax,
        Math.max(MANUAL_MOTION.animRateMin, speedNow / walkSpeed),
      ),
    );
  }

  poke(): void {
    if (!this.isInteractive) return;
    const prev = this.renderer.current_animation_name();
    const fromPose = prev === "Sit" || prev === "Sleep";
    this.toIdle();
    this.mode = "poke";
    this.pokeT = 0;
    if (fromPose) {
      // 与直接点击一致：先经 Relax 的 0.2s 混合，再从 Relax 硬切 Interact
      this.play("Relax");
      this.pokeLead = POSE_POKE_LEAD_SECONDS;
    } else {
      this.pokeLead = 0;
      this.play("Interact", false, true);
    }
  }

  beginDrag(x: number, y: number, now: number): boolean {
    if (!this.isInteractive) return false;
    this.dragging = true;
    this.toIdle();
    this.dragOffX = x - this.move.pos.x;
    this.dragOffY = y - this.move.pos.y;
    this.downX = x;
    this.downY = y;
    this.downAt = now;
    this.moved = false;
    return true;
  }

  dragTo(x: number, y: number): void {
    if (!this.dragging) return;
    this.refreshBoundsFromContent();
    if (!this.moved) {
      if (Math.hypot(x - this.downX, y - this.downY) < 4) return;
      this.moved = true;
    }
    this.move = setMovementPosition(
      this.move,
      clampPosition(
        { x: x - this.dragOffX, y: y - this.dragOffY },
        this.bounds,
      ),
    );
  }

  endDrag(now: number): "poke" | "idle" {
    if (!this.dragging) return "idle";
    this.dragging = false;
    if (!this.moved && now - this.downAt < 600) {
      this.mode = "poke";
      this.pokeT = 0;
      this.play("Interact", false, true);
      return "poke";
    }
    this.toIdle();
    return "idle";
  }

  hide(immediate = false): void {
    this.manual = false;
    this.dragging = false;
    this.mode = "idle";
    this.resetManualVelocity();
    this.move = cancelMovement(this.move, true);
    this.renderer.set_yaw(this.move.yaw);
    if (immediate) {
      this.visible = false;
      this.reveal = 0;
      this.revealDir = 0;
      this.outlineAlpha = 0;
      this.renderer.set_reveal(0);
      this.renderer.set_outline(0);
      return;
    }
    if (!this.visible) return;
    if (this.reveal <= 0) {
      this.visible = false;
      this.revealDir = 0;
      this.renderer.set_reveal(0);
      return;
    }
    this.play("Relax");
    this.revealDir = -1;
  }

  show(): void {
    if (this.visible && this.revealDir === 0 && this.reveal >= 1) return;
    this.visible = true;
    this.manual = false;
    this.toIdle();
    this.lastPhase = null;
    this.lastPhaseCheck = -Infinity;
    this.lastPhaseEpoch = -1;
    this.play("Relax");
    this.revealDir = 1;
    this.renderer.set_reveal(this.reveal);
  }

  private stepPoke(delta: number): void {
    if (this.pokeLead > 0) {
      this.pokeLead -= delta;
      if (this.pokeLead <= 0) this.play("Interact", false, true);
      return;
    }
    this.pokeT += delta;
    if (this.pokeT >= this.profile.pokeSeconds) this.toIdle();
  }

  step(now: number, dt: number): void {
    if (!this.visible) return;
    const delta = Math.min(0.05, Math.max(0, dt));
    // 描边透明度独立于角色 reveal：进入/退出互动、开关切换都走同一段淡入淡出。
    const outlineTarget =
      this.outline && this.manual && this.isInteractive ? 1 : 0;
    if (this.outlineAlpha !== outlineTarget) {
      const fade = delta / Math.max(0.001, OUTLINE_TIMING.fadeSeconds);
      this.outlineAlpha =
        outlineTarget > this.outlineAlpha
          ? Math.min(1, this.outlineAlpha + fade)
          : Math.max(0, this.outlineAlpha - fade);
    }
    if (this.revealDir !== 0) {
      const seconds =
        this.revealDir > 0
          ? REVEAL_TIMING.enterSeconds
          : REVEAL_TIMING.exitSeconds;
      this.reveal += (this.revealDir * delta) / seconds;
      if (this.reveal >= 1) {
        this.reveal = 1;
        this.revealDir = 0;
      } else if (this.reveal <= 0) {
        this.reveal = 0;
        this.revealDir = 0;
        this.visible = false;
      }
      this.renderer.set_reveal(this.reveal);
      return;
    }
    if (this.manual) {
      if (this.mode === "poke") this.stepPoke(delta);
      return;
    }

    if (this.shared.mode === "time") {
      if (
        this.lastPhaseCheck < 0 ||
        now - this.lastPhaseCheck > 10_000 ||
        this.lastPhaseEpoch !== this.shared.virtualEpoch
      ) {
        this.lastPhaseCheck = now;
        this.lastPhaseEpoch = this.shared.virtualEpoch;
        const info = this.phaseInfo();
        if (this.lastPhase === null) {
          this.lastPhase = info.phase;
        } else if (info.phase !== this.lastPhase) {
          if (this.mode === "sleep" && !allowsSleep(info.phase)) {
            this.toIdle();
          }
          this.lastPhase = info.phase;
        }
      }
    } else {
      this.lastPhase = null;
      this.lastPhaseCheck = -Infinity;
      this.lastPhaseEpoch = this.shared.virtualEpoch;
    }

    if (this.dragging) {
      this.play("Relax");
      return;
    }

    if (this.mode === "poke") {
      this.stepPoke(delta);
      return;
    }

    if (this.mode === "walk" || this.mode === "turn") {
      const result = stepMovement(
        this.move,
        delta,
        this.bounds,
        this.options,
      );
      this.move = result.state;
      this.renderer.set_yaw(this.move.yaw);
      this.play("Move");
      if (
        result.event === "arrived" ||
        result.event === "blocked" ||
        this.move.phase === "idle"
      ) {
        this.toIdle();
      } else {
        this.mode = this.move.phase === "turn" ? "turn" : "walk";
      }
      return;
    }

    if (this.mode === "sit") {
      this.play("Sit");
      this.sitTime += delta;
      if (this.sitTime >= this.profile.sitSeconds) this.toIdle();
      return;
    }

    if (this.mode === "sleep") {
      this.play("Sleep");
      this.sleepTime += delta;
      if (this.sleepTime >= this.sleepLimit) this.toIdle();
      return;
    }

    this.play("Relax");
    this.idleTime += delta;
    if (this.idleTime >= this.idleLimit) this.pickNext();
  }
}
