// SPDX-License-Identifier: LicenseRef-Spine-Runtimes-3.8
// Derived from Esoteric Software's spine-ts 3.8 (Spine Runtimes).
// This file is part of the Spine Runtimes integration in this project; NOT Apache-2.0.
// License texts: LICENSES/Spine-Runtimes-License-3.8.txt
//               LICENSES/Spine-Runtimes-License-2025.txt
/**
 * Spine 3.8 姿态计算 — ported from spine38/skeleton.py（spine-ts 3.8 Bone/Skeleton）。
 * 与 Python 同构：骨骼与约束按依赖序交错排入 update_cache（约束改父骨骼后子骨骼才更新）。
 */
import {
  BoneData, SlotData, SkeletonData, Attachment, VertexAttachment, RegionAttachment, MeshAttachment,
  ClippingAttachment, TRANSFORM_NORMAL, TRANSFORM_ONLY_TRANSLATION,
  TRANSFORM_NO_ROTATION_OR_REFLECTION, TRANSFORM_NO_SCALE
} from './loader'
import { Color } from './utils'
import { IkConstraint, TransformConstraint, PathConstraint } from './constraints'

const RAD_DEG = 180.0 / Math.PI
const DEG_RAD = Math.PI / 180.0

function cos_deg(d: number): number {
  return Math.cos(d * DEG_RAD)
}

function sin_deg(d: number): number {
  return Math.sin(d * DEG_RAD)
}

export class Bone {
  data: BoneData
  skeleton: Skeleton
  parent: Bone | null
  x: number
  y: number
  rotation: number
  scale_x: number
  scale_y: number
  shear_x: number
  shear_y: number
  // 已应用变换（约束系统使用）
  ax: number
  ay: number
  arotation: number
  ascale_x: number
  ascale_y: number
  ashear_x: number
  ashear_y: number
  a: number = 0.0
  b: number = 0.0
  c: number = 0.0
  d: number = 0.0
  world_x: number = 0.0
  world_y: number = 0.0
  active: boolean = true
  applied_valid: boolean = false
  children: Bone[] = []
  sorted: boolean = false

  constructor(data: BoneData, skeleton: Skeleton, parent: Bone | null) {
    this.data = data
    this.skeleton = skeleton
    this.parent = parent
    this.x = data.x
    this.y = data.y
    this.rotation = data.rotation
    this.scale_x = data.scale_x
    this.scale_y = data.scale_y
    this.shear_x = data.shear_x
    this.shear_y = data.shear_y
    this.ax = this.x
    this.ay = this.y
    this.arotation = this.rotation
    this.ascale_x = this.scale_x
    this.ascale_y = this.scale_y
    this.ashear_x = this.shear_x
    this.ashear_y = this.shear_y
  }

  update_world_transform(): void {
    this._update_with(this.x, this.y, this.rotation, this.scale_x, this.scale_y, this.shear_x, this.shear_y)
  }

  update(): void {
    this.update_world_transform()
  }

  // 从世界矩阵反推局部已应用变换（约束修改世界坐标后调用）
  update_applied_transform(): void {
    this.applied_valid = true
    let parent = this.parent
    if (parent === null) {
      this.ax = this.world_x
      this.ay = this.world_y
      this.arotation = Math.atan2(this.c, this.a) * RAD_DEG
      this.ascale_x = Math.sqrt(this.a * this.a + this.c * this.c)
      this.ascale_y = Math.sqrt(this.b * this.b + this.d * this.d)
      this.ashear_x = 0.0
      this.ashear_y = Math.atan2(this.a * this.b + this.c * this.d,
        this.a * this.d - this.b * this.c) * RAD_DEG
      return
    }
    let pa = parent.a
    let pb = parent.b
    let pc = parent.c
    let pd = parent.d
    let det = pa * pd - pb * pc
    if (Math.abs(det) < 0.0001) {
      return
    }
    let pid = 1.0 / det
    let dx = this.world_x - parent.world_x
    let dy = this.world_y - parent.world_y
    this.ax = dx * pd * pid - dy * pb * pid
    this.ay = dy * pa * pid - dx * pc * pid
    let ia = pid * pd
    let id_ = pid * pa
    let ib = pid * pb
    let ic = pid * pc
    let ra = ia * this.a - ib * this.c
    let rb = ia * this.b - ib * this.d
    let rc = id_ * this.c - ic * this.a
    let rd = id_ * this.d - ic * this.b
    this.ashear_x = 0.0
    this.ascale_x = Math.sqrt(ra * ra + rc * rc)
    if (this.ascale_x > 0.0001) {
      let det2 = ra * rd - rb * rc
      this.ascale_y = det2 / this.ascale_x
      this.ashear_y = Math.atan2(ra * rb + rc * rd, det2) * RAD_DEG
      this.arotation = Math.atan2(rc, ra) * RAD_DEG
    } else {
      this.ascale_x = 0.0
      this.ascale_y = Math.sqrt(rb * rb + rd * rd)
      this.ashear_y = 0.0
      this.arotation = 90 - Math.atan2(rd, rb) * RAD_DEG
    }
  }

  _update_with(x: number, y: number, rotation: number, scale_x: number, scale_y: number,
    shear_x: number, shear_y: number): void {
    this.ax = x
    this.ay = y
    this.arotation = rotation
    this.ascale_x = scale_x
    this.ascale_y = scale_y
    this.ashear_x = shear_x
    this.ashear_y = shear_y
    this.applied_valid = true
    let parent = this.parent
    if (parent === null) {
      let skeleton = this.skeleton
      let rotation_y = rotation + 90 + shear_y
      let sx = skeleton.scale_x
      let sy = skeleton.scale_y
      this.a = cos_deg(rotation + shear_x) * scale_x * sx
      this.b = cos_deg(rotation_y) * scale_y * sx
      this.c = sin_deg(rotation + shear_x) * scale_x * sy
      this.d = sin_deg(rotation_y) * scale_y * sy
      this.world_x = x * sx + skeleton.x
      this.world_y = y * sy + skeleton.y
      return
    }
    let pa = parent.a
    let pb = parent.b
    let pc = parent.c
    let pd = parent.d
    this.world_x = pa * x + pb * y + parent.world_x
    this.world_y = pc * x + pd * y + parent.world_y
    let mode = this.data.transform_mode
    if (mode === TRANSFORM_NORMAL) {
      let rotation_y = rotation + 90 + shear_y
      let la = cos_deg(rotation + shear_x) * scale_x
      let lb = cos_deg(rotation_y) * scale_y
      let lc = sin_deg(rotation + shear_x) * scale_x
      let ld = sin_deg(rotation_y) * scale_y
      this.a = pa * la + pb * lc
      this.b = pa * lb + pb * ld
      this.c = pc * la + pd * lc
      this.d = pc * lb + pd * ld
      return
    }
    if (mode === TRANSFORM_ONLY_TRANSLATION) {
      let rotation_y = rotation + 90 + shear_y
      this.a = cos_deg(rotation + shear_x) * scale_x
      this.b = cos_deg(rotation_y) * scale_y
      this.c = sin_deg(rotation + shear_x) * scale_x
      this.d = sin_deg(rotation_y) * scale_y
    } else if (mode === TRANSFORM_NO_ROTATION_OR_REFLECTION) {
      let s = pa * pa + pc * pc
      let prx = 0.0
      if (s > 0.0001) {
        s = Math.abs(pa * pd - pb * pc) / s
        pa /= this.skeleton.scale_x
        pc /= this.skeleton.scale_y
        pb = pc * s
        pd = pa * s
        prx = Math.atan2(pc, pa) * RAD_DEG
      } else {
        pa = 0.0
        pc = 0.0
        prx = 90 - Math.atan2(pd, pb) * RAD_DEG
      }
      let rx = rotation + shear_x - prx
      let ry = rotation + shear_y - prx + 90
      let la = cos_deg(rx) * scale_x
      let lb = cos_deg(ry) * scale_y
      let lc = sin_deg(rx) * scale_x
      let ld = sin_deg(ry) * scale_y
      this.a = pa * la - pb * lc
      this.b = pa * lb - pb * ld
      this.c = pc * la + pd * lc
      this.d = pc * lb + pd * ld
    } else { // NO_SCALE / NO_SCALE_OR_REFLECTION
      let cos = cos_deg(rotation)
      let sin = sin_deg(rotation)
      let za = (pa * cos + pb * sin) / this.skeleton.scale_x
      let zc = (pc * cos + pd * sin) / this.skeleton.scale_y
      let s = Math.sqrt(za * za + zc * zc)
      if (s > 0.00001) {
        s = 1.0 / s
      }
      za *= s
      zc *= s
      s = Math.sqrt(za * za + zc * zc)
      if (mode === TRANSFORM_NO_SCALE && ((pa * pd - pb * pc < 0) !==
        ((this.skeleton.scale_x < 0) !== (this.skeleton.scale_y < 0)))) {
        s = -s
      }
      let r = Math.PI / 2 + Math.atan2(zc, za)
      let zb = Math.cos(r) * s
      let zd = Math.sin(r) * s
      let la = cos_deg(shear_x) * scale_x
      let lb = cos_deg(90 + shear_y) * scale_y
      let lc = sin_deg(shear_x) * scale_x
      let ld = sin_deg(90 + shear_y) * scale_y
      this.a = za * la + zb * lc
      this.b = za * lb + zb * ld
      this.c = zc * la + zd * lc
      this.d = zc * lb + zd * ld
    }
    this.a *= this.skeleton.scale_x
    this.b *= this.skeleton.scale_x
    this.c *= this.skeleton.scale_y
    this.d *= this.skeleton.scale_y
  }
}

export class Slot {
  data: SlotData
  bone: Bone
  color: Color
  dark_color: Color | null = null
  attachment: Attachment | null = null
  deform: number[] = [] // 变形缓冲区（DeformTimeline 写入，顶点计算消费）

  constructor(data: SlotData, bone: Bone) {
    this.data = data
    this.bone = bone
    this.color = new Color(data.color.r, data.color.g, data.color.b, data.color.a)
    if (data.dark_color !== null) {
      this.dark_color = new Color(data.dark_color.r, data.dark_color.g, data.dark_color.b, 1.0)
    }
  }

  set_attachment(attachment: Attachment | null): void {
    this.attachment = attachment
    this.deform.length = 0
  }
}

export type Updatable = Bone | IkConstraint | TransformConstraint | PathConstraint

export class Skeleton {
  data: SkeletonData
  bones: Bone[] = []
  slots: Slot[] = []
  draw_order: Slot[] = []
  x: number
  y: number
  scale_x: number = 1.0
  scale_y: number = 1.0
  color: Color
  // 持久约束实例（动画层会写入 mix/position 等属性）
  ik_constraints: IkConstraint[] = []
  transform_constraints: TransformConstraint[] = []
  path_constraints: PathConstraint[] = []
  update_cache: Updatable[] = []
  update_cache_reset: Bone[] = []

  constructor(data: SkeletonData) {
    this.data = data
    this.x = data.x
    this.y = data.y
    this.color = new Color(1, 1, 1, 1)
    for (let i = 0; i < data.bones.length; i++) {
      let bone_data = data.bones[i]
      let parent = bone_data.parent !== null ? this.bones[bone_data.parent.index] : null
      this.bones.push(new Bone(bone_data, this, parent))
    }
    for (let i = 0; i < this.bones.length; i++) {
      let bone = this.bones[i]
      if (bone.parent !== null) {
        bone.parent.children.push(bone)
      }
    }
    for (let i = 0; i < data.slots.length; i++) {
      let slot_data = data.slots[i]
      this.slots.push(new Slot(slot_data, this.bones[slot_data.bone_data.index]))
    }
    this.draw_order = this.slots.slice()
    for (let i = 0; i < data.ik_constraints.length; i++) {
      this.ik_constraints.push(new IkConstraint(data.ik_constraints[i], this))
    }
    for (let i = 0; i < data.transform_constraints.length; i++) {
      this.transform_constraints.push(new TransformConstraint(data.transform_constraints[i], this))
    }
    for (let i = 0; i < data.path_constraints.length; i++) {
      this.path_constraints.push(new PathConstraint(data.path_constraints[i], this))
    }
    this._build_update_cache()
  }

  // ── 更新缓存（照 spine-ts 3.8 Skeleton.updateCache 移植） ──
  private _sort_bone(bone: Bone): void {
    if (bone.sorted) {
      return
    }
    if (bone.parent !== null) {
      this._sort_bone(bone.parent)
    }
    bone.sorted = true
    this.update_cache.push(bone)
  }

  private _sort_reset(bones: Bone[]): void {
    for (let i = 0; i < bones.length; i++) {
      let bone = bones[i]
      if (!bone.active) {
        continue
      }
      if (bone.sorted) {
        this._sort_reset(bone.children)
      }
      bone.sorted = false
    }
  }

  private _sort_ik_constraint(constraint: IkConstraint): void {
    constraint.active = constraint.target.active
    if (!constraint.active) {
      return
    }
    this._sort_bone(constraint.target)
    let constrained = constraint.bones
    let parent = constrained[0]
    this._sort_bone(parent)
    if (constrained.length > 1) {
      let child = constrained[constrained.length - 1]
      if (this.update_cache.indexOf(child) === -1) {
        this.update_cache_reset.push(child)
      }
    }
    this.update_cache.push(constraint)
    this._sort_reset(parent.children)
    constrained[constrained.length - 1].sorted = true
  }

  private _sort_transform_constraint(constraint: TransformConstraint): void {
    constraint.active = constraint.target.active
    if (!constraint.active) {
      return
    }
    this._sort_bone(constraint.target)
    let constrained = constraint.bones
    if (constraint.data.local) {
      for (let i = 0; i < constrained.length; i++) {
        let child = constrained[i]
        this._sort_bone(child.parent!)
        if (this.update_cache.indexOf(child) === -1) {
          this.update_cache_reset.push(child)
        }
      }
    } else {
      for (let i = 0; i < constrained.length; i++) {
        this._sort_bone(constrained[i])
      }
    }
    this.update_cache.push(constraint)
    for (let i = 0; i < constrained.length; i++) {
      this._sort_reset(constrained[i].children)
    }
    for (let i = 0; i < constrained.length; i++) {
      constrained[i].sorted = true
    }
  }

  private _sort_path_constraint(constraint: PathConstraint): void {
    constraint.active = constraint.target.bone.active
    if (!constraint.active) {
      return
    }
    let constrained = constraint.bones
    for (let i = 0; i < constrained.length; i++) {
      this._sort_bone(constrained[i])
    }
    this.update_cache.push(constraint)
    for (let i = 0; i < constrained.length; i++) {
      this._sort_reset(constrained[i].children)
    }
    for (let i = 0; i < constrained.length; i++) {
      constrained[i].sorted = true
    }
  }

  private _build_update_cache(): void {
    for (let i = 0; i < this.bones.length; i++) {
      let bone = this.bones[i]
      bone.sorted = bone.data.skin_required
      bone.active = !bone.sorted
    }
    let ik = this.ik_constraints
    let tx = this.transform_constraints
    let path = this.path_constraints
    let constraint_count = ik.length + tx.length + path.length
    for (let i = 0; i < constraint_count; i++) {
      let found = false
      for (let j = 0; j < ik.length; j++) {
        let c = ik[j]
        if (c.data.order === i) {
          this._sort_ik_constraint(c)
          found = true
          break
        }
      }
      if (found) {
        continue
      }
      for (let j = 0; j < tx.length; j++) {
        let c = tx[j]
        if (c.data.order === i) {
          this._sort_transform_constraint(c)
          found = true
          break
        }
      }
      if (found) {
        continue
      }
      for (let j = 0; j < path.length; j++) {
        let c = path[j]
        if (c.data.order === i) {
          this._sort_path_constraint(c)
          break
        }
      }
    }
    for (let i = 0; i < this.bones.length; i++) {
      this._sort_bone(this.bones[i])
    }
  }

  update_world_transform(): void {
    for (let i = 0; i < this.update_cache_reset.length; i++) {
      let bone = this.update_cache_reset[i]
      bone.ax = bone.x
      bone.ay = bone.y
      bone.arotation = bone.rotation
      bone.ascale_x = bone.scale_x
      bone.ascale_y = bone.scale_y
      bone.ashear_x = bone.shear_x
      bone.ashear_y = bone.shear_y
      bone.applied_valid = true
    }
    for (let i = 0; i < this.update_cache.length; i++) {
      this.update_cache[i].update()
    }
  }

  set_to_setup_pose(): void {
    for (let i = 0; i < this.bones.length; i++) {
      let bone = this.bones[i]
      bone.x = bone.data.x
      bone.y = bone.data.y
      bone.rotation = bone.data.rotation
      bone.scale_x = bone.data.scale_x
      bone.scale_y = bone.data.scale_y
      bone.shear_x = bone.data.shear_x
      bone.shear_y = bone.data.shear_y
    }
    for (let i = 0; i < this.ik_constraints.length; i++) {
      let c = this.ik_constraints[i]
      c.mix = c.data.mix
      c.softness = c.data.softness
      c.bend_direction = c.data.bend_direction
      c.compress = c.data.compress
      c.stretch = c.data.stretch
      c.uniform = c.data.uniform
    }
    for (let i = 0; i < this.transform_constraints.length; i++) {
      let c = this.transform_constraints[i]
      c.rotate_mix = c.data.rotate_mix
      c.translate_mix = c.data.translate_mix
      c.scale_mix = c.data.scale_mix
      c.shear_mix = c.data.shear_mix
    }
    for (let i = 0; i < this.path_constraints.length; i++) {
      let c = this.path_constraints[i]
      c.position = c.data.position
      c.spacing = c.data.spacing
      c.rotate_mix = c.data.rotate_mix
      c.translate_mix = c.data.translate_mix
    }
    for (let i = 0; i < this.slots.length; i++) {
      let slot = this.slots[i]
      slot.color.set(slot.data.color.r, slot.data.color.g, slot.data.color.b, slot.data.color.a)
      let name = slot.data.attachment_name
      slot.attachment = name !== null ? this.get_attachment(slot.data.index, name) : null
    }
    for (let i = 0; i < this.slots.length; i++) {
      this.slots[i].deform.length = 0
    }
    this.draw_order = this.slots.slice()
  }

  get_attachment(slot_index: number, name: string): Attachment | null {
    return this.data.default_skin !== null ? this.data.default_skin.get_attachment(slot_index, name) : null
  }

  find_bone(name: string): BoneData | null {
    return this.data.find_bone(name)
  }

  // 计算包围盒（不含约束），返回 (offset_x, offset_y, w, h)
  get_bounds(): number[] {
    let xs: number[] = []
    let ys: number[] = []
    for (let i = 0; i < this.draw_order.length; i++) {
      let slot = this.draw_order[i]
      let att = slot.attachment
      if (att === null) {
        continue
      }
      let wvl = att instanceof VertexAttachment ? att.world_vertices_length : 0
      let count = wvl !== 0 ? wvl : 8
      let verts = compute_attachment_vertices(slot, att, 0, count)
      for (let v = 0; v < verts.length; v += 2) {
        xs.push(verts[v])
        ys.push(verts[v + 1])
      }
    }
    if (xs.length === 0) {
      return [0.0, 0.0, 0.0, 0.0]
    }
    let min_x = xs[0]
    let min_y = ys[0]
    let max_x = xs[0]
    let max_y = ys[0]
    for (let i = 1; i < xs.length; i++) {
      if (xs[i] < min_x) min_x = xs[i]
      if (xs[i] > max_x) max_x = xs[i]
      if (ys[i] < min_y) min_y = ys[i]
      if (ys[i] > max_y) max_y = ys[i]
    }
    return [min_x, min_y, max_x - min_x, max_y - min_y]
  }
}

// 区域附件 4 角世界坐标，返回 8 元素列表
export function compute_region_vertices(slot: Slot, region_attachment: RegionAttachment,
  out: number[] | null = null): number[] {
  let bone = slot.bone
  let off = region_attachment.offset
  let x = bone.world_x
  let y = bone.world_y
  let a = bone.a
  let b = bone.b
  let c = bone.c
  let d = bone.d
  if (out === null) {
    out = [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0]
  }
  out[0] = off[0] * a + off[1] * b + x
  out[1] = off[0] * c + off[1] * d + y
  out[2] = off[2] * a + off[3] * b + x
  out[3] = off[2] * c + off[3] * d + y
  out[4] = off[4] * a + off[5] * b + x
  out[5] = off[4] * c + off[5] * d + y
  out[6] = off[6] * a + off[7] * b + x
  out[7] = off[6] * c + off[7] * d + y
  return out
}

// 网格附件世界顶点（含变形）。变形值在 slot.deform 缓冲区。
export function compute_mesh_vertices(slot: Slot, mesh: VertexAttachment, start: number = 0,
  count: number = -1, out: number[] | null = null): number[] {
  let skeleton_bones = slot.bone.skeleton.bones
  let deform = slot.deform
  let bones = mesh.bones
  let vertices = mesh.vertices
  if (count < 0) {
    count = Math.floor(mesh.world_vertices_length / 2)
  }
  if (out === null) {
    out = new Array<number>(count * 2).fill(0.0)
  }
  if (bones === null) {
    // 非加权：deform 非空时替换顶点数组（绝对坐标语义）
    if (deform.length > 0) {
      vertices = deform
    }
    let a = slot.bone.a
    let b = slot.bone.b
    let c = slot.bone.c
    let d = slot.bone.d
    let wx = slot.bone.world_x
    let wy = slot.bone.world_y
    for (let v = start; v < start + count; v++) {
      let vx = vertices![v * 2]
      let vy = vertices![v * 2 + 1]
      out[(v - start) * 2] = vx * a + vy * b + wx
      out[(v - start) * 2 + 1] = vx * c + vy * d + wy
    }
    return out
  }
  // 加权：vertices 存 (x, y, weight) 三元组，bones 存 [数量, 骨骼索引...]；
  // deform 增量按权重条目序号索引（官方 spine-ts 语义——按顶点索引是眼白泄漏根因，2026-08-20 修复）
  let o = 0
  let bi = 0
  let vi = 0
  let f = 0
  let v = start
  if (start > 0) {
    for (let s = 0; s < start; s++) {
      let n = bones![bi]
      bi += n + 1
      f += n
    }
    vi = f * 3
  }
  while (v < start + count) {
    let bone_count = bones![bi]
    bi += 1
    let wx = 0.0
    let wy = 0.0
    for (let j = 0; j < bone_count; j++) {
      let bone_index = bones![bi]
      bi += 1
      let bone = skeleton_bones[bone_index]
      let vx: number
      let vy: number
      if (deform.length > 0) {
        vx = vertices![vi] + deform[f * 2]
        vy = vertices![vi + 1] + deform[f * 2 + 1]
      } else {
        vx = vertices![vi]
        vy = vertices![vi + 1]
      }
      let weight = vertices![vi + 2]
      vi += 3
      f += 1
      wx += (vx * bone.a + vy * bone.b + bone.world_x) * weight
      wy += (vx * bone.c + vy * bone.d + bone.world_y) * weight
    }
    out[o] = wx
    out[o + 1] = wy
    o += 2
    v += 1
  }
  return out
}

// 统一入口：根据附件类型计算世界顶点
export function compute_attachment_vertices(slot: Slot, attachment: Attachment, start: number,
  count: number): number[] {
  if (attachment instanceof RegionAttachment) {
    return compute_region_vertices(slot, attachment)
  }
  if (attachment instanceof MeshAttachment) {
    let vcount = count !== 0 ? Math.floor(count / 2) : -1
    return compute_mesh_vertices(slot, attachment, start, vcount)
  }
  if (attachment instanceof ClippingAttachment) {
    let vcount = count !== 0 ? Math.floor(count / 2) : -1
    return compute_mesh_vertices(slot, attachment, start, vcount)
  }
  return []
}
