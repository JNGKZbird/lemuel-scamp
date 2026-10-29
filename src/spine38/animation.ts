// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * Spine 3.8 动画时间线应用 — 精确移植自 spine38/animation.py（spine-ts 3.8）。
 * 与 Python 差异：时间线为类型化类（见 loader.ets）；槽位颜色/变形/路径曲线在 loader 读弃 → 恒线性。
 * Python 的 AnimationStateImpl/_frame_percent 未被引擎使用，ArkTS 版不移植（死代码）。
 */
import {
  Animation, BoneTimeline, SlotTimeline, DeformTimeline, DrawOrderTimeline, DrawOrderOffset,
  IkTimeline, TransformTimeline, PathTimeline, Curve, SLOT_ATTACHMENT, Attachment, MeshAttachment
} from './loader'
import { Skeleton, Slot } from './skeleton'
import { Color } from './utils'

// ── 曲线求值 ────────────────────────────────────────────
function _bezier(t: number, p0: number, p1: number, p2: number, p3: number): number {
  let mt = 1.0 - t
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3
}

function _bezier_x(t: number, cx1: number, cx2: number): number {
  return _bezier(t, 0.0, cx1, cx2, 1.0)
}

function _bezier_y(t: number, cy1: number, cy2: number): number {
  return _bezier(t, 0.0, cy1, cy2, 1.0)
}

// 曲线时间映射：x∈[0,1]，返回插值进度（JS getCurvePercent 语义）
export function curve_percent(curve: Curve | null, x: number): number {
  if (curve === null || curve.type === 0) { // linear
    return x
  }
  if (curve.type === 1) { // stepped
    return 0.0
  }
  let cx1 = curve.cx1
  let cy1 = curve.cy1
  let cx2 = curve.cx2
  let cy2 = curve.cy2
  let epsilon = 0.00001
  let t = x
  for (let i = 0; i < 8; i++) {
    let xt = _bezier_x(t, cx1, cx2) - x
    if (Math.abs(xt) < epsilon) {
      return _bezier_y(t, cy1, cy2)
    }
    let d = 3 * (1 - t) * (1 - t) * cx1 + 6 * (1 - t) * t * (cx2 - cx1) + 3 * t * t * (1 - cx2)
    if (Math.abs(d) < 0.0001) {
      break
    }
    t -= xt / d
  }
  let lo = 0.0
  let hi = 1.0
  t = x
  if (t < lo) {
    return _bezier_y(lo, cy1, cy2)
  }
  if (t > hi) {
    return _bezier_y(hi, cy1, cy2)
  }
  while (lo < hi) {
    let xt = _bezier_x(t, cx1, cx2)
    if (Math.abs(xt - x) < epsilon) {
      return _bezier_y(t, cy1, cy2)
    }
    if (x > xt) {
      lo = t
    } else {
      hi = t
    }
    t = (hi - lo) / 2 + lo
  }
  return _bezier_y(t, cy1, cy2)
}

// JS 的 16384 角度环绕技巧：包装到 [-180, 180)
function _wrap_angle(value: number): number {
  value -= (16384 - Math.floor(16384.499999999996 - value / 360.0)) * 360.0
  return value
}

// 返回时间所在帧区间的【下一帧】索引（JS Animation.binarySearch 语义）
function _binary_search(frames: number[], time: number, entries: number): number {
  let n = Math.floor(frames.length / entries)
  if (time <= frames[0]) {
    return entries // 指向第二帧（若存在）
  }
  if (time >= frames[(n - 1) * entries]) {
    return (n - 1) * entries
  }
  let lo = 1
  let hi = n - 1
  while (lo < hi) {
    let mid = Math.floor((lo + hi) / 2)
    if (frames[mid * entries] <= time) {
      lo = mid + 1
    } else {
      hi = mid
    }
  }
  return lo * entries
}

function _lerp(a: number, b: number, p: number): number {
  return a + (b - a) * p
}

interface TimedFrame {
  time: number
}

function _frame_times(frames: TimedFrame[]): number[] {
  let ts: number[] = []
  for (let i = 0; i < frames.length; i++) {
    ts.push(frames[i].time)
  }
  return ts
}

// ── 时间线应用（JS blend=first + alpha 语义） ─────────────
export function apply_rotate(tl: BoneTimeline, skeleton: Skeleton, time: number, alpha: number = 1.0): void {
  let frames = tl.frames
  let curves = tl.curves
  let bone = skeleton.bones[tl.bone]
  let n = frames.length
  if (time < frames[0].time) {
    // blend=first: 向 setup 值靠拢
    let r = bone.data.rotation - bone.rotation
    r = _wrap_angle(r)
    bone.rotation += r * alpha
    return
  }
  if (time >= frames[n - 1].time) {
    // PREV_ROTATION = 最后一帧自身的旋转值
    let prev_rot = frames[n - 1].f1
    let r = frames[n - 1].f1 - prev_rot
    r = _wrap_angle(r)
    r = prev_rot + r
    r += bone.data.rotation - bone.rotation
    bone.rotation += _wrap_angle(r) * alpha
    return
  }
  // 二分定位下一帧
  let ts = _frame_times(frames)
  let frame = _binary_search(ts, time, 1)
  let fi = frame - 1 // 当前帧索引
  // PREV_ROTATION = 当前帧自身的旋转值
  let prev_rot = frames[fi].f1
  let frame_time = frames[fi].time
  let next_time = frames[fi + 1].time
  let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
  let curve = fi < curves.length ? curves[fi] : null
  percent = curve_percent(curve, percent)
  let r = frames[fi + 1].f1 - prev_rot
  r = _wrap_angle(r)
  r = prev_rot + r * percent
  r += bone.data.rotation - bone.rotation
  bone.rotation += _wrap_angle(r) * alpha
}

// 平移时间线：帧值是对 data 的偏移（blend=first 语义）
export function apply_translate(tl: BoneTimeline, skeleton: Skeleton, time: number, alpha: number = 1.0): void {
  let frames = tl.frames
  let curves = tl.curves
  let bone = skeleton.bones[tl.bone]
  if (time < frames[0].time) {
    bone.x += (bone.data.x - bone.x) * alpha
    bone.y += (bone.data.y - bone.y) * alpha
    return
  }
  let n = frames.length
  let x: number
  let y: number
  if (time >= frames[n - 1].time) {
    x = frames[n - 1].f1
    y = frames[n - 1].f2
  } else {
    let ts = _frame_times(frames)
    let frame = _binary_search(ts, time, 1)
    let fi = frame - 1
    let x0 = frames[fi].f1
    let y0 = frames[fi].f2
    let x1 = frames[fi + 1].f1
    let y1 = frames[fi + 1].f2
    let frame_time = frames[fi].time
    let next_time = frames[fi + 1].time
    let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
    let curve = fi < curves.length ? curves[fi] : null
    percent = curve_percent(curve, percent)
    x = _lerp(x0, x1, percent)
    y = _lerp(y0, y1, percent)
  }
  bone.x += (bone.data.x + x - bone.x) * alpha
  bone.y += (bone.data.y + y - bone.y) * alpha
}

// 缩放时间线：帧值是对 data 的倍率；剪切：帧值是对 data 的偏移
export function apply_scale_shear(tl: BoneTimeline, skeleton: Skeleton, time: number, alpha: number,
  is_scale: boolean): void {
  let frames = tl.frames
  let curves = tl.curves
  let bone = skeleton.bones[tl.bone]
  if (time < frames[0].time) {
    if (is_scale) {
      bone.scale_x += (bone.data.scale_x - bone.scale_x) * alpha
      bone.scale_y += (bone.data.scale_y - bone.scale_y) * alpha
    } else {
      bone.shear_x += (bone.data.shear_x - bone.shear_x) * alpha
      bone.shear_y += (bone.data.shear_y - bone.shear_y) * alpha
    }
    return
  }
  let n = frames.length
  let x: number
  let y: number
  if (time >= frames[n - 1].time) {
    x = frames[n - 1].f1
    y = frames[n - 1].f2
  } else {
    let ts = _frame_times(frames)
    let frame = _binary_search(ts, time, 1)
    let fi = frame - 1
    let x0 = frames[fi].f1
    let y0 = frames[fi].f2
    let x1 = frames[fi + 1].f1
    let y1 = frames[fi + 1].f2
    let frame_time = frames[fi].time
    let next_time = frames[fi + 1].time
    let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
    let curve = fi < curves.length ? curves[fi] : null
    percent = curve_percent(curve, percent)
    x = _lerp(x0, x1, percent)
    y = _lerp(y0, y1, percent)
  }
  if (is_scale) {
    // 倍率语义：raw × data
    let vx = x * bone.data.scale_x
    let vy = y * bone.data.scale_y
    bone.scale_x += (vx - bone.scale_x) * alpha
    bone.scale_y += (vy - bone.scale_y) * alpha
  } else {
    // 偏移语义：data + raw
    let vx = bone.data.shear_x + x
    let vy = bone.data.shear_y + y
    bone.shear_x += (vx - bone.shear_x) * alpha
    bone.shear_y += (vy - bone.shear_y) * alpha
  }
}

export function apply_color(tl: SlotTimeline, skeleton: Skeleton, time: number, alpha: number = 1.0): void {
  let frames = tl.color_frames
  let slot = skeleton.slots[tl.slot]
  let n = frames.length
  let c: Color
  if (time < frames[0].time) {
    c = frames[0].color
  } else if (time >= frames[n - 1].time) {
    c = frames[n - 1].color
  } else {
    let ts = _frame_times(frames)
    let frame = _binary_search(ts, time, 1)
    let fi = frame - 1
    let c0 = frames[fi].color
    let c1 = frames[fi + 1].color
    let frame_time = frames[fi].time
    let next_time = frames[fi + 1].time
    let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
    percent = curve_percent(null, percent) // 槽位颜色曲线在 loader 读弃 → 线性
    c = new Color(_lerp(c0.r, c1.r, percent), _lerp(c0.g, c1.g, percent),
      _lerp(c0.b, c1.b, percent), _lerp(c0.a, c1.a, percent))
  }
  slot.color.r += (c.r - slot.color.r) * alpha
  slot.color.g += (c.g - slot.color.g) * alpha
  slot.color.b += (c.b - slot.color.b) * alpha
  slot.color.a += (c.a - slot.color.a) * alpha
}

export function apply_attachment(tl: SlotTimeline, skeleton: Skeleton, time: number, alpha: number): void {
  let frames = tl.attachment_frames
  let slot_index = tl.slot
  let name = frames[0].name
  for (let i = 0; i < frames.length; i++) {
    if (time >= frames[i].time) {
      name = frames[i].name
    } else {
      break
    }
  }
  let slot = skeleton.slots[slot_index]
  if (alpha < 0.5) {
    return
  }
  slot.attachment = name !== null ? skeleton.get_attachment(slot_index, name) : null
}

// 变形写入 slot.deform 缓冲区（JS 语义）：非加权=绝对坐标，加权=增量
export function apply_deform(tl: DeformTimeline, skeleton: Skeleton, time: number, alpha: number = 1.0): void {
  let frames = tl.frames
  let attachment = tl.attachment
  let slot_index = tl.slot
  if (attachment === null || alpha <= 0) {
    return
  }
  let slot = skeleton.slots[slot_index]
  let cur_att = slot.attachment
  if (cur_att === null) {
    return
  }
  // JS 守卫：当前附件的变形目标必须匹配
  let target: Attachment = (cur_att instanceof MeshAttachment && cur_att.deform_attachment !== null) ?
    cur_att.deform_attachment : cur_att
  if (target !== attachment) {
    return
  }
  if (time < frames[0].time) {
    // blend=first alpha=1：清空变形（回到基础顶点）
    slot.deform.length = 0
    return
  }
  let n = frames.length
  let deform: number[]
  if (time >= frames[n - 1].time) {
    deform = frames[n - 1].values
  } else {
    let ts = _frame_times(frames)
    let frame = _binary_search(ts, time, 1)
    let fi = frame - 1
    let d0 = frames[fi].values
    let d1 = frames[fi + 1].values
    let frame_time = frames[fi].time
    let next_time = frames[fi + 1].time
    let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
    percent = curve_percent(null, percent) // 变形曲线在 loader 读弃 → 线性
    deform = []
    for (let i2 = 0; i2 < d0.length; i2++) {
      deform.push(_lerp(d0[i2], d1[i2], percent))
    }
  }
  if (alpha >= 1) {
    slot.deform = deform.slice()
  } else {
    if (slot.deform.length < deform.length) {
      slot.deform = new Array<number>(deform.length).fill(0.0)
    }
    for (let i2 = 0; i2 < deform.length; i2++) {
      slot.deform[i2] += (deform[i2] - slot.deform[i2]) * alpha
    }
  }
}

export function apply_draw_order(tl: DrawOrderTimeline, skeleton: Skeleton, time: number): void {
  let frames = tl.frames
  let slot_count = skeleton.slots.length
  let offsets: DrawOrderOffset[]
  if (time < frames[0].time) {
    offsets = frames[0].offsets
  } else if (time >= frames[frames.length - 1].time) {
    offsets = frames[frames.length - 1].offsets
  } else {
    offsets = frames[0].offsets
    for (let i = 0; i < frames.length; i++) {
      if (time >= frames[i].time) {
        offsets = frames[i].offsets
      } else {
        break
      }
    }
  }
  let draw_order = new Array<number>(slot_count).fill(-1)
  let unchanged: number[] = []
  let original_index = 0
  for (let i = 0; i < offsets.length; i++) {
    let slot_i = offsets[i].slot
    let off = offsets[i].offset
    while (original_index !== slot_i) {
      unchanged.push(original_index)
      original_index += 1
    }
    draw_order[original_index + off] = original_index
    original_index += 1
  }
  while (original_index < slot_count) {
    unchanged.push(original_index)
    original_index += 1
  }
  let ui = unchanged.length - 1
  for (let i = slot_count - 1; i >= 0; i--) {
    if (draw_order[i] === -1) {
      draw_order[i] = unchanged[ui]
      ui -= 1
    }
  }
  let new_order: Slot[] = []
  for (let i = 0; i < slot_count; i++) {
    new_order.push(skeleton.slots[draw_order[i]])
  }
  skeleton.draw_order = new_order
}

// ── 约束时间线 ──────────────────────────────────────────
export function apply_ik_timelines(animation: Animation, skeleton: Skeleton, time: number,
  alpha: number = 1.0): void {
  for (let i = 0; i < animation.ik_timelines.length; i++) {
    let tl: IkTimeline = animation.ik_timelines[i]
    let c = skeleton.ik_constraints[tl.index]
    let frames = tl.frames
    let curves = tl.curves
    let n = frames.length
    let mix: number
    let softness: number
    let bend: number
    let compress: number
    let stretch: number
    if (time < frames[0].time) {
      mix = frames[0].mix
      softness = frames[0].softness
      bend = frames[0].bend
      compress = frames[0].compress ? 1 : 0
      stretch = frames[0].stretch ? 1 : 0
    } else if (time >= frames[n - 1].time) {
      mix = frames[n - 1].mix
      softness = frames[n - 1].softness
      bend = frames[n - 1].bend
      compress = frames[n - 1].compress ? 1 : 0
      stretch = frames[n - 1].stretch ? 1 : 0
    } else {
      let ts = _frame_times(frames)
      let frame = _binary_search(ts, time, 1)
      let fi = frame - 1
      let f0 = frames[fi]
      let f1 = frames[fi + 1]
      let frame_time = f0.time
      let next_time = f1.time
      let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
      let curve = fi < curves.length ? curves[fi] : null
      percent = curve_percent(curve, percent)
      mix = _lerp(f0.mix, f1.mix, percent)
      softness = _lerp(f0.softness, f1.softness, percent)
      bend = _lerp(f0.bend, f1.bend, percent)
      compress = _lerp(f0.compress ? 1 : 0, f1.compress ? 1 : 0, percent)
      stretch = _lerp(f0.stretch ? 1 : 0, f1.stretch ? 1 : 0, percent)
    }
    c.mix += (mix - c.mix) * alpha
    c.softness += (softness - c.softness) * alpha
    if (alpha >= 1) {
      c.bend_direction = Math.trunc(bend)
      c.compress = compress !== 0
      c.stretch = stretch !== 0
    }
  }
}

export function apply_transform_timelines(animation: Animation, skeleton: Skeleton, time: number,
  alpha: number = 1.0): void {
  for (let i = 0; i < animation.transform_timelines.length; i++) {
    let tl: TransformTimeline = animation.transform_timelines[i]
    let c = skeleton.transform_constraints[tl.index]
    let frames = tl.frames
    let curves = tl.curves
    let n = frames.length
    let rm: number
    let tm: number
    let sm: number
    let hm: number
    if (time < frames[0].time) {
      rm = frames[0].f1
      tm = frames[0].f2
      sm = frames[0].f3
      hm = frames[0].f4
    } else if (time >= frames[n - 1].time) {
      rm = frames[n - 1].f1
      tm = frames[n - 1].f2
      sm = frames[n - 1].f3
      hm = frames[n - 1].f4
    } else {
      let ts = _frame_times(frames)
      let frame = _binary_search(ts, time, 1)
      let fi = frame - 1
      let f0 = frames[fi]
      let f1 = frames[fi + 1]
      let frame_time = f0.time
      let next_time = f1.time
      let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
      let curve = fi < curves.length ? curves[fi] : null
      percent = curve_percent(curve, percent)
      rm = _lerp(f0.f1, f1.f1, percent)
      tm = _lerp(f0.f2, f1.f2, percent)
      sm = _lerp(f0.f3, f1.f3, percent)
      hm = _lerp(f0.f4, f1.f4, percent)
    }
    c.rotate_mix += (rm - c.rotate_mix) * alpha
    c.translate_mix += (tm - c.translate_mix) * alpha
    c.scale_mix += (sm - c.scale_mix) * alpha
    c.shear_mix += (hm - c.shear_mix) * alpha
  }
}

export function apply_path_timelines(animation: Animation, skeleton: Skeleton, time: number,
  alpha: number = 1.0): void {
  for (let i = 0; i < animation.path_timelines.length; i++) {
    let tl: PathTimeline = animation.path_timelines[i]
    let c = skeleton.path_constraints[tl.index]
    if (tl.type === 2) { // mix
      let frames = tl.mix_frames
      let n = frames.length
      let m1: number
      let m2: number
      if (time < frames[0].time) {
        m1 = frames[0].m1
        m2 = frames[0].m2
      } else if (time >= frames[n - 1].time) {
        m1 = frames[n - 1].m1
        m2 = frames[n - 1].m2
      } else {
        let ts = _frame_times(frames)
        let frame = _binary_search(ts, time, 1)
        let fi = frame - 1
        let frame_time = frames[fi].time
        let next_time = frames[fi + 1].time
        let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
        percent = curve_percent(null, percent) // 路径曲线在 loader 读弃 → 线性
        m1 = _lerp(frames[fi].m1, frames[fi + 1].m1, percent)
        m2 = _lerp(frames[fi].m2, frames[fi + 1].m2, percent)
      }
      c.rotate_mix += (m1 - c.rotate_mix) * alpha
      c.translate_mix += (m2 - c.translate_mix) * alpha
    } else { // position / spacing
      let frames = tl.frames
      let n = frames.length
      let v: number
      if (time < frames[0].time) {
        v = frames[0].value
      } else if (time >= frames[n - 1].time) {
        v = frames[n - 1].value
      } else {
        let ts = _frame_times(frames)
        let frame = _binary_search(ts, time, 1)
        let fi = frame - 1
        let frame_time = frames[fi].time
        let next_time = frames[fi + 1].time
        let percent = next_time > frame_time ? (time - frame_time) / (next_time - frame_time) : 0.0
        percent = curve_percent(null, percent) // 路径曲线在 loader 读弃 → 线性
        v = _lerp(frames[fi].value, frames[fi + 1].value, percent)
      }
      if (tl.type === 0) {
        c.position += (v - c.position) * alpha
      } else {
        c.spacing += (v - c.spacing) * alpha
      }
    }
  }
}

export function reset_constraints(skeleton: Skeleton): void {
  for (let i = 0; i < skeleton.ik_constraints.length; i++) {
    let c = skeleton.ik_constraints[i]
    c.mix = c.data.mix
    c.softness = c.data.softness
    c.bend_direction = c.data.bend_direction
    c.compress = c.data.compress
    c.stretch = c.data.stretch
    c.uniform = c.data.uniform
  }
  for (let i = 0; i < skeleton.transform_constraints.length; i++) {
    let c = skeleton.transform_constraints[i]
    c.rotate_mix = c.data.rotate_mix
    c.translate_mix = c.data.translate_mix
    c.scale_mix = c.data.scale_mix
    c.shear_mix = c.data.shear_mix
  }
  for (let i = 0; i < skeleton.path_constraints.length; i++) {
    let c = skeleton.path_constraints[i]
    c.position = c.data.position
    c.spacing = c.data.spacing
    c.rotate_mix = c.data.rotate_mix
    c.translate_mix = c.data.translate_mix
  }
}

// 应用动画全部时间线（JS blend=first + direction=mixIn 语义，alpha=1 时等价）
export function apply_animation(animation: Animation, skeleton: Skeleton, time: number, loop: boolean,
  alpha: number = 1.0, reset_constraints_before: boolean = true): void {
  let duration = animation.duration
  if (loop && duration > 0) {
    time = time % duration
  }
  if (reset_constraints_before) reset_constraints(skeleton)
  for (let i = 0; i < animation.bone_timelines.length; i++) {
    let tl = animation.bone_timelines[i]
    if (tl.type === 0) { // rotate
      apply_rotate(tl, skeleton, time, alpha)
    } else if (tl.type === 1) { // translate
      apply_translate(tl, skeleton, time, alpha)
    } else { // scale / shear
      apply_scale_shear(tl, skeleton, time, alpha, tl.type === 2)
    }
  }
  for (let i = 0; i < animation.slot_timelines.length; i++) {
    let tl = animation.slot_timelines[i]
    if (tl.type === SLOT_ATTACHMENT) {
      apply_attachment(tl, skeleton, time, alpha)
    } else {
      apply_color(tl, skeleton, time, alpha)
    }
  }
  for (let i = 0; i < animation.deform_timelines.length; i++) {
    apply_deform(animation.deform_timelines[i], skeleton, time, alpha)
  }
  for (let i = 0; i < animation.draw_order_timelines.length; i++) {
    apply_draw_order(animation.draw_order_timelines[i], skeleton, time)
  }
  apply_ik_timelines(animation, skeleton, time, alpha)
  apply_transform_timelines(animation, skeleton, time, alpha)
  apply_path_timelines(animation, skeleton, time, alpha)
}
