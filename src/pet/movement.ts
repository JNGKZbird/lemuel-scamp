export type Rng = () => number;

export type Vec2 = { x: number; y: number };

// 窗口左上角的可活动范围（逻辑像素）。
export type Bounds = { left: number; top: number; right: number; bottom: number };

export type TargetTier = "local" | "global";

export type Target = {
  pos: Vec2;
  tier: TargetTier;
  cell: number | null;
};

export type CoverageGrid = {
  cols: number;
  rows: number;
  visits: number[];
  lastVisit: number[];
  picks: number;
};

export type MovePhase = "idle" | "turn" | "walk";

export type MovementState = {
  pos: Vec2;
  phase: MovePhase;
  target: Target | null;
  waypoint: Vec2 | null;
  dirX: 1 | -1;
  facing: 1 | -1;
  yaw: number;
  turnFrom: number;
  turnTo: number;
  turnElapsed: number;
  accumulator: number;
  stuck: number;
  grid: CoverageGrid;
};

export type MoveOptions = {
  slopeK: number;
  speed: number;
  turnSeconds: number;
  fixedDt: number;
  maxSubSteps: number;
  localMin: number;
  localMax: number;
  globalMin: number;
  globalMax: number;
  localShare: number;
  arrivalRadius: number;
  minDisplacement: number;
  waypointMargin: number;
  edgeBias: number;
  gridCols: number;
  gridRows: number;
  marginX: number;
  marginY: number;
};

export type StepEvent = "none" | "leg" | "arrived" | "blocked";

export type StepResult = {
  state: MovementState;
  event: StepEvent;
};

export const DEFAULT_MOVE_OPTIONS: MoveOptions = {
  slopeK: 1 / 3,
  speed: 120,
  turnSeconds: 0.15,
  fixedDt: 1 / 60,
  maxSubSteps: 5,
  localMin: 50,
  localMax: 200,
  globalMin: 200,
  globalMax: 1000,
  localShare: 0.7,
  arrivalRadius: 10,
  minDisplacement: 20,
  waypointMargin: 40,
  edgeBias: 120,
  gridCols: 4,
  gridRows: 3,
  // 窗口模式同样按可见网格贴屏幕边：0 边距。
  marginX: 0,
  marginY: 0,
};

export function resolveMoveOptions(
  opts: Partial<MoveOptions> = {},
): MoveOptions {
  return { ...DEFAULT_MOVE_OPTIONS, ...opts };
}

export function mulberry32(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function signOf(v: number): 1 | -1 {
  return v >= 0 ? 1 : -1;
}

function hypot(x: number, y: number): number {
  return Math.hypot(x, y);
}

function safeBounds(bounds: Bounds): Bounds {
  const left = Number.isFinite(bounds.left) ? bounds.left : 0;
  const top = Number.isFinite(bounds.top) ? bounds.top : 0;
  const right = Number.isFinite(bounds.right) ? bounds.right : left;
  const bottom = Number.isFinite(bounds.bottom) ? bounds.bottom : top;
  return {
    left: Math.min(left, right),
    top: Math.min(top, bottom),
    right: Math.max(left, right),
    bottom: Math.max(top, bottom),
  };
}

export function clampPosition(pos: Vec2, bounds: Bounds): Vec2 {
  const b = safeBounds(bounds);
  const cx = Number.isFinite(pos.x) ? pos.x : (b.left + b.right) / 2;
  const cy = Number.isFinite(pos.y) ? pos.y : (b.top + b.bottom) / 2;
  return {
    x: clamp(cx, b.left, b.right),
    y: clamp(cy, b.top, b.bottom),
  };
}

export function createCoverageGrid(cols: number, rows: number): CoverageGrid {
  const c = Math.max(1, Math.floor(cols));
  const r = Math.max(1, Math.floor(rows));
  return {
    cols: c,
    rows: r,
    visits: new Array(c * r).fill(0),
    lastVisit: new Array(c * r).fill(0),
    picks: 0,
  };
}

export function cellIndex(
  pos: Vec2,
  bounds: Bounds,
  grid: CoverageGrid,
): number {
  const b = safeBounds(bounds);
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  if (width <= 0 || height <= 0) return 0;
  const cx = Math.floor(((pos.x - b.left) / width) * grid.cols);
  const cy = Math.floor(((pos.y - b.top) / height) * grid.rows);
  return (
    clamp(cy, 0, grid.rows - 1) * grid.cols +
    clamp(cx, 0, grid.cols - 1)
  );
}

export function recordVisit(
  grid: CoverageGrid,
  cell: number,
): CoverageGrid {
  if (cell < 0 || cell >= grid.visits.length) return grid;
  const visits = grid.visits.slice();
  const lastVisit = grid.lastVisit.slice();
  visits[cell] += 1;
  lastVisit[cell] = grid.picks;
  return { ...grid, visits, lastVisit };
}

export function sampleSlope(rng: Rng, k: number): number {
  return k * (rng() + rng() - 1);
}

function pointInCell(
  rng: Rng,
  bounds: Bounds,
  grid: CoverageGrid,
  cell: number,
): Vec2 {
  const b = safeBounds(bounds);
  const col = cell % grid.cols;
  const row = Math.floor(cell / grid.cols);
  const cellW = (b.right - b.left) / grid.cols;
  const cellH = (b.bottom - b.top) / grid.rows;
  return clampPosition(
    {
      x: b.left + (col + rng()) * cellW,
      y: b.top + (row + rng()) * cellH,
    },
    b,
  );
}

function cellCenter(
  bounds: Bounds,
  grid: CoverageGrid,
  cell: number,
): Vec2 {
  const b = safeBounds(bounds);
  const col = cell % grid.cols;
  const row = Math.floor(cell / grid.cols);
  const cellW = (b.right - b.left) / grid.cols;
  const cellH = (b.bottom - b.top) / grid.rows;
  return {
    x: b.left + (col + 0.5) * cellW,
    y: b.top + (row + 0.5) * cellH,
  };
}

function weightedIndex(rng: Rng, weights: number[]): number {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return Math.floor(rng() * weights.length);
  let target = rng() * total;
  for (let i = 0; i < weights.length; i += 1) {
    target -= Math.max(0, weights[i]);
    if (target <= 0) return i;
  }
  return weights.length - 1;
}

function canReach(
  pos: Vec2,
  target: Vec2,
  bounds: Bounds,
  opts: MoveOptions,
): boolean {
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  if (!Number.isFinite(dx) || !Number.isFinite(dy)) return false;
  if (Math.abs(dx) < opts.minDisplacement) return false;
  if (Math.abs(dy) <= opts.slopeK * Math.abs(dx)) return true;
  const waypoint = planWaypoint(pos, target, bounds, opts);
  if (!waypoint) return false;
  const finalDx = target.x - waypoint.x;
  const finalDy = target.y - waypoint.y;
  return (
    Math.abs(finalDx) >= opts.minDisplacement &&
    Math.abs(finalDy) <= opts.slopeK * Math.abs(finalDx) + 1e-9
  );
}

export function sampleLocalTarget(
  rng: Rng,
  pos: Vec2,
  bounds: Bounds,
  opts: MoveOptions,
): Target | null {
  const b = safeBounds(bounds);
  const width = b.right - b.left;
  if (width <= 0) return null;

  const center = (b.left + b.right) / 2;
  let dir: 1 | -1;
  if (pos.x - b.left < opts.edgeBias && b.right - pos.x > opts.edgeBias) {
    dir = 1;
  } else if (b.right - pos.x < opts.edgeBias && pos.x - b.left > opts.edgeBias) {
    dir = -1;
  } else if (b.right - b.left <= opts.edgeBias * 2) {
    dir = pos.x < center ? 1 : -1;
  } else {
    dir = rng() < 0.5 ? -1 : 1;
  }

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const distance = opts.localMin + rng() * (opts.localMax - opts.localMin);
    const slope = sampleSlope(rng, opts.slopeK);
    const dx = (dir * distance) / Math.sqrt(1 + slope * slope);
    const dy = slope * dx;
    const candidate = clampPosition({ x: pos.x + dx, y: pos.y + dy }, b);
    if (
      hypot(candidate.x - pos.x, candidate.y - pos.y) >=
      opts.minDisplacement
    ) {
      return { pos: candidate, tier: "local", cell: null };
    }
    dir = dir === 1 ? -1 : 1;
  }
  return null;
}

export function sampleGlobalTarget(
  rng: Rng,
  pos: Vec2,
  bounds: Bounds,
  grid: CoverageGrid,
  opts: MoveOptions,
): Target | null {
  const b = safeBounds(bounds);
  const width = b.right - b.left;
  const height = b.bottom - b.top;
  if (width <= 0 || height <= 0) return null;

  const current = cellIndex(pos, b, grid);
  const count = grid.visits.length;
  const weights = new Array(count).fill(0);
  for (let i = 0; i < count; i += 1) {
    if (count > 1 && i === current) continue;
    const visits = grid.visits[i] ?? 0;
    const age = grid.picks - (grid.lastVisit[i] ?? 0) + 1;
    weights[i] = (1 + age * 0.25) / (1 + visits);
  }

  const diagonal = hypot(width, height);
  const maxDistance = Math.min(opts.globalMax, diagonal);
  if (maxDistance <= 0) return null;
  const minDistance = Math.min(opts.globalMin, maxDistance * 0.75);

  for (let attempt = 0; attempt < 10; attempt += 1) {
    const cell = weightedIndex(rng, weights);
    const candidate = pointInCell(rng, b, grid, cell);
    const candidateCell = cellIndex(candidate, b, grid);
    if (count > 1 && candidateCell === current) continue;
    const distance = hypot(
      candidate.x - pos.x,
      candidate.y - pos.y,
    );
    if (
      distance >= minDistance &&
      distance <= maxDistance &&
      canReach(pos, candidate, b, opts)
    ) {
      return {
        pos: candidate,
        tier: "global",
        cell: candidateCell,
      };
    }
  }

  let farCell = 0;
  let farDistance = -1;
  for (let i = 0; i < count; i += 1) {
    if (count > 1 && i === current) continue;
    const center = cellCenter(b, grid, i);
    const distance = hypot(center.x - pos.x, center.y - pos.y);
    if (distance > farDistance) {
      farDistance = distance;
      farCell = i;
    }
  }
  if (farDistance < minDistance) return null;
  const center = cellCenter(b, grid, farCell);
  const scale = Math.min(1, maxDistance / farDistance);
  const point = clampPosition(
    {
      x: pos.x + (center.x - pos.x) * scale,
      y: pos.y + (center.y - pos.y) * scale,
    },
    b,
  );
  if (!canReach(pos, point, b, opts)) return null;
  const pointCell = cellIndex(point, b, grid);
  if (count > 1 && pointCell === current) return null;
  return {
    pos: point,
    tier: "global",
    cell: pointCell,
  };
}

export function sampleTarget(
  rng: Rng,
  pos: Vec2,
  bounds: Bounds,
  grid: CoverageGrid,
  opts: MoveOptions,
): Target | null {
  const b = safeBounds(bounds);
  grid.picks += 1;
  const localFirst = rng() < opts.localShare;
  let target = localFirst
    ? sampleLocalTarget(rng, pos, b, opts)
    : sampleGlobalTarget(rng, pos, b, grid, opts);
  if (!target) {
    target = localFirst
      ? sampleGlobalTarget(rng, pos, b, grid, opts)
      : sampleLocalTarget(rng, pos, b, opts);
  }
  if (!target) return null;
  return { ...target, cell: cellIndex(target.pos, b, grid) };
}

export function planWaypoint(
  pos: Vec2,
  target: Vec2,
  bounds: Bounds,
  opts: MoveOptions,
): Vec2 | null {
  const b = safeBounds(bounds);
  const dx = target.x - pos.x;
  const dy = target.y - pos.y;
  if (opts.slopeK <= 0) return null;
  if (Math.abs(dx) < opts.minDisplacement) return null;
  if (Math.abs(dy) <= opts.slopeK * Math.abs(dx)) return null;

  // 先沿浅斜线升到目标高度，再横走到目标；这样每一腿都在斜率锥内。
  const run = Math.abs(dy) / opts.slopeK + opts.waypointMargin;
  const dir = signOf(dx);
  const candidates: Vec2[] = [
    { x: target.x + dir * run, y: target.y },
    { x: target.x - dir * run, y: target.y },
  ];

  for (const candidate of candidates) {
    const waypoint = clampPosition(candidate, b);
    if (Math.abs(waypoint.y - target.y) > 1e-6) continue;
    const firstDx = waypoint.x - pos.x;
    const firstDy = waypoint.y - pos.y;
    if (Math.abs(firstDx) < opts.minDisplacement) continue;
    if (Math.abs(firstDy) > opts.slopeK * Math.abs(firstDx) + 1e-9) continue;
    if (Math.abs(target.x - waypoint.x) < opts.minDisplacement) continue;
    return waypoint;
  }
  return null;
}

export function moveVelocity(
  from: Vec2,
  to: Vec2,
  speed: number,
  k: number,
): Vec2 {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (Math.abs(dx) < 1e-6) return { x: 0, y: 0 };

  const s = Math.max(0, speed);
  const theta = Math.atan2(Math.abs(dy), Math.abs(dx));
  const vx = signOf(dx) * s * Math.cos(theta);
  let vy = signOf(dy) * s * Math.sin(theta);
  const cap = Math.max(0, k) * Math.abs(vx);
  if (Math.abs(vy) > cap) vy = signOf(vy) * cap;
  return { x: vx, y: vy };
}

function withTarget(
  state: MovementState,
  target: Target,
  waypoint: Vec2 | null,
): MovementState {
  const first = waypoint ?? target.pos;
  const dirX = signOf(first.x - state.pos.x);
  const turnTo = dirX === 1 ? 0 : Math.PI;
  return {
    ...state,
    target,
    waypoint,
    dirX,
    phase: state.facing === dirX ? "walk" : "turn",
    turnFrom: state.yaw,
    turnTo,
    turnElapsed: 0,
    stuck: 0,
    accumulator: 0,
  };
}

export function pickWalk(
  state: MovementState,
  bounds: Bounds,
  rng: Rng,
  opts: MoveOptions,
): MovementState | null {
  const b = safeBounds(bounds);
  const outside =
    state.pos.x < b.left ||
    state.pos.x > b.right ||
    state.pos.y < b.top ||
    state.pos.y > b.bottom;

  if (outside) {
    const clamped = clampPosition(state.pos, b);
    let x = clamped.x;
    if (Math.abs(x - state.pos.x) < opts.minDisplacement) {
      const dir =
        state.pos.x < b.left
          ? 1
          : state.pos.x > b.right
            ? -1
            : state.pos.x < (b.left + b.right) / 2
              ? 1
              : -1;
      x = clampPosition(
        { x: state.pos.x + dir * Math.max(opts.minDisplacement, 60), y: clamped.y },
        b,
      ).x;
    }
    if (Math.abs(x - state.pos.x) < 1e-6) return null;
    const target: Target = {
      pos: { x, y: clamped.y },
      tier: "global",
      cell: null,
    };
    const waypoint = planWaypoint(state.pos, target.pos, b, opts);
    if (
      Math.abs(target.pos.y - state.pos.y) >
        opts.slopeK * Math.abs(target.pos.x - state.pos.x) &&
      !waypoint
    ) {
      return null;
    }
    return withTarget(state, target, waypoint);
  }

  const target = sampleTarget(rng, state.pos, b, state.grid, opts);
  if (!target) return null;

  const dx = target.pos.x - state.pos.x;
  const dy = target.pos.y - state.pos.y;
  if (Math.abs(dx) < opts.minDisplacement) return null;
  if (hypot(dx, dy) <= opts.arrivalRadius) return null;

  const waypoint = planWaypoint(state.pos, target.pos, b, opts);
  if (Math.abs(dy) > opts.slopeK * Math.abs(dx) && !waypoint) {
    return null;
  }
  if (waypoint) {
    const finalDx = target.pos.x - waypoint.x;
    const finalDy = target.pos.y - waypoint.y;
    if (
      Math.abs(finalDx) < opts.minDisplacement ||
      Math.abs(finalDy) > opts.slopeK * Math.abs(finalDx)
    ) {
      return null;
    }
  }

  return withTarget(state, target, waypoint);
}

function finishLeg(
  state: MovementState,
): StepEvent {
  if (!state.target) {
    state.phase = "idle";
    state.accumulator = 0;
    return "blocked";
  }

  if (state.waypoint) {
    state.pos = { ...state.waypoint };
    state.waypoint = null;
    const dx = state.target.pos.x - state.pos.x;
    if (Math.abs(dx) < 1e-6) {
      state.phase = "idle";
      state.target = null;
      state.accumulator = 0;
      return "blocked";
    }
    state.dirX = signOf(dx);
    state.turnFrom = state.yaw;
    state.turnTo = state.dirX === 1 ? 0 : Math.PI;
    state.turnElapsed = 0;
    state.phase = state.facing === state.dirX ? "walk" : "turn";
    state.stuck = 0;
    return "leg";
  }

  state.pos = { ...state.target.pos };
  if (state.target.cell !== null) {
    state.grid = recordVisit(state.grid, state.target.cell);
  }
  state.target = null;
  state.phase = "idle";
  state.accumulator = 0;
  state.stuck = 0;
  return "arrived";
}

export function createMovementState(
  pos: Vec2,
  bounds: Bounds,
  seed: number,
  opts?: Partial<MoveOptions>,
): MovementState {
  const o = resolveMoveOptions(opts);
  const facing: 1 | -1 = mulberry32(seed)() < 0.5 ? -1 : 1;
  const yaw = facing === 1 ? 0 : Math.PI;
  return {
    pos: clampPosition(pos, bounds),
    phase: "idle",
    target: null,
    waypoint: null,
    dirX: facing,
    facing,
    yaw,
    turnFrom: yaw,
    turnTo: yaw,
    turnElapsed: 0,
    accumulator: 0,
    stuck: 0,
    grid: createCoverageGrid(o.gridCols, o.gridRows),
  };
}

export function stepMovement(
  state: MovementState,
  dt: number,
  bounds: Bounds,
  opts: MoveOptions,
): StepResult {
  if (!Number.isFinite(dt) || dt <= 0) {
    return { state, event: "none" };
  }

  const b = safeBounds(bounds);
  const s: MovementState = {
    ...state,
    pos: { ...state.pos },
    target: state.target
      ? { ...state.target, pos: { ...state.target.pos } }
      : null,
    waypoint: state.waypoint ? { ...state.waypoint } : null,
    grid: state.grid,
  };

  s.accumulator = Math.min(
    s.accumulator + dt,
    opts.fixedDt * opts.maxSubSteps,
  );
  const steps = Math.min(
    opts.maxSubSteps,
    Math.floor(s.accumulator / opts.fixedDt),
  );
  if (steps <= 0) return { state: s, event: "none" };

  let event: StepEvent = "none";

  for (let i = 0; i < steps; i += 1) {
    s.accumulator -= opts.fixedDt;

    if (s.phase === "idle") {
      s.accumulator = 0;
      break;
    }

    if (s.phase === "turn") {
      s.turnElapsed += opts.fixedDt;
      const progress = Math.min(
        1,
        s.turnElapsed / Math.max(1e-6, opts.turnSeconds),
      );
      s.yaw = s.turnFrom + (s.turnTo - s.turnFrom) * progress;
      if (progress >= 1) {
        s.yaw = s.turnTo;
        s.facing = s.dirX;
        s.phase = "walk";
        s.turnElapsed = 0;
      }
      continue;
    }

    if (!s.target) {
      s.phase = "idle";
      s.accumulator = 0;
      event = "blocked";
      break;
    }

    const leg = s.waypoint ?? s.target.pos;
    const distance = hypot(leg.x - s.pos.x, leg.y - s.pos.y);
    if (distance <= opts.arrivalRadius) {
      event = finishLeg(s);
      break;
    }

    const velocity = moveVelocity(s.pos, leg, opts.speed, opts.slopeK);
    const stepLength = hypot(velocity.x, velocity.y) * opts.fixedDt;
    if (stepLength < 1e-9) {
      s.phase = "idle";
      s.target = null;
      s.waypoint = null;
      s.accumulator = 0;
      event = "blocked";
      break;
    }

    if (stepLength >= distance) {
      s.pos = { ...leg };
    } else {
      s.pos = {
        x: s.pos.x + velocity.x * opts.fixedDt,
        y: s.pos.y + velocity.y * opts.fixedDt,
      };
    }

    const clamped = clampPosition(s.pos, b);
    s.pos = clamped;

    const after = hypot(leg.x - s.pos.x, leg.y - s.pos.y);
    if (after < distance - 1e-9) {
      s.stuck = 0;
    } else {
      s.stuck += opts.fixedDt;
    }

    if (s.stuck > 0.6) {
      s.phase = "idle";
      s.target = null;
      s.waypoint = null;
      s.accumulator = 0;
      event = "blocked";
      break;
    }

    if (after <= opts.arrivalRadius) {
      event = finishLeg(s);
      break;
    }
  }

  return { state: s, event };
}

export function cancelMovement(
  state: MovementState,
  snapTurn = true,
): MovementState {
  const yaw =
    snapTurn && state.phase === "turn" ? state.turnTo : state.yaw;
  const facing =
    snapTurn && state.phase === "turn" ? state.dirX : state.facing;
  return {
    ...state,
    yaw,
    facing,
    phase: "idle",
    target: null,
    waypoint: null,
    turnElapsed: 0,
    stuck: 0,
    accumulator: 0,
  };
}

export function setMovementPosition(
  state: MovementState,
  pos: Vec2,
): MovementState {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y)) return state;
  return {
    ...state,
    pos: { ...pos },
    phase: "idle",
    target: null,
    waypoint: null,
    turnElapsed: 0,
    stuck: 0,
    accumulator: 0,
  };
}

export function contentWindowBounds(
  workArea: Bounds,
  content: Bounds,
  marginX: number,
  marginY: number,
): Bounds {
  const work = safeBounds(workArea);
  const c = safeBounds(content);
  const left = work.left - c.left + marginX;
  const top = work.top - c.top + marginY;
  const right = work.right - c.right - marginX;
  const bottom = work.bottom - c.bottom - marginY;

  if (left > right || top > bottom) {
    const cx = (work.left + work.right) / 2;
    const cy = (work.top + work.bottom) / 2;
    return { left: cx, top: cy, right: cx, bottom: cy };
  }
  return { left, top, right, bottom };
}
